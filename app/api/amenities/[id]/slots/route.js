import Amenity from "@/models/amenities/Amenity";
import AmenityTimeSlot from "@/models/amenities/AmenityTimeSlot";
import { slotGenerateSchema, slotUpsertSchema } from "@/lib/amenities/schemas";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION } from "@/lib/amenities/constants";
import { regenerateSlots } from "@/lib/amenities/slotEngine";
import { toMinutes } from "@/lib/amenities/time";
import { gate, ok, created, fail, zodFail, isId, withAmenityRoute, CAPABILITY } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.VIEW_AMENITIES);
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid amenity id");

  const sp = new URL(request.url).searchParams;
  const filter = { amenityId: id, societyId: g.societyId };
  if (sp.get("includeInactive") !== "1") filter.isActive = true;
  if (sp.get("dayOfWeek")) filter.dayOfWeek = Number(sp.get("dayOfWeek"));

  const slots = await AmenityTimeSlot.find(filter).sort({ dayOfWeek: 1, startMinutes: 1 }).lean();

  // Grouped by day so the UI can render a week view directly.
  const byDay = Array.from({ length: 7 }, () => []);
  for (const s of slots) byDay[s.dayOfWeek].push(s);

  return ok({ slots, byDay, count: slots.length });
});

// POST /api/amenities/:id/slots — (re)generate the grid from policy.
// dryRun returns the computed grid without writing, so the admin can preview
// "30 minute slots with a 5 minute buffer" before committing.
export const POST = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.MANAGE_SLOTS);
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid amenity id");

  const parsed = slotGenerateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return zodFail(parsed);

  const amenity = await Amenity.findOne({ _id: id, societyId: g.societyId, isDeleted: false });
  if (!amenity) return fail(404, "Amenity not found");
  if (!amenity.slotPolicy?.enabled && !parsed.data.dryRun) {
    return fail(409, "Time slots are disabled for this amenity. Enable them first.");
  }

  const { days, replaceCustom, dryRun, ...policyOverrides } = parsed.data;

  let result;
  try {
    result = await regenerateSlots({
      amenity,
      policyOverrides,
      days: days || null,
      replaceCustom: Boolean(replaceCustom),
      dryRun: Boolean(dryRun),
    });
  } catch (err) {
    // Buffer >= duration and similar policy contradictions.
    return fail(422, err.message);
  }

  if (!dryRun) {
    await logAmenityActivity({
      societyId: g.societyId,
      entityType: "SLOT",
      entityId: amenity._id,
      amenityId: amenity._id,
      amenityName: amenity.name,
      action: ACTIVITY_ACTION.SLOTS_REGENERATED,
      actor: g.actor,
      newValue: { generated: result.generated, policy: { ...amenity.slotPolicy, ...policyOverrides } },
      note: `Generated ${result.generated} slots`,
    });
  }

  return ok(result);
});

// PUT — add or edit a single custom slot (the "Clubhouse: custom slots" case).
// Marked isCustom so a later regeneration does not wipe it.
export const PUT = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.MANAGE_SLOTS);
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid amenity id");

  const parsed = slotUpsertSchema.safeParse(await request.json());
  if (!parsed.success) return zodFail(parsed);

  const amenity = await Amenity.findOne({ _id: id, societyId: g.societyId, isDeleted: false }).lean();
  if (!amenity) return fail(404, "Amenity not found");

  const startMinutes = toMinutes(parsed.data.startTime);
  const endMinutes = toMinutes(parsed.data.endTime);

  // Overlap check within the same day — two slots covering 09:15 would make
  // check-in slot attribution ambiguous.
  const overlapping = await AmenityTimeSlot.findOne({
    amenityId: id,
    dayOfWeek: parsed.data.dayOfWeek,
    isActive: true,
    startMinutes: { $lt: endMinutes },
    endMinutes: { $gt: startMinutes },
  }).lean();

  if (overlapping && overlapping.startMinutes !== startMinutes) {
    return fail(409, `This overlaps the existing ${overlapping.startTime}-${overlapping.endTime} slot`);
  }

  const slot = await AmenityTimeSlot.findOneAndUpdate(
    { amenityId: id, dayOfWeek: parsed.data.dayOfWeek, startMinutes },
    {
      $set: {
        societyId: g.societyId,
        amenityId: id,
        dayOfWeek: parsed.data.dayOfWeek,
        startTime: parsed.data.startTime,
        endTime: parsed.data.endTime,
        startMinutes,
        endMinutes,
        capacity: parsed.data.capacity ?? null,
        label: parsed.data.label || "",
        isActive: parsed.data.isActive ?? true,
        isCustom: true,
      },
    },
    { new: true, upsert: true },
  ).lean();

  await logAmenityActivity({
    societyId: g.societyId,
    entityType: "SLOT",
    entityId: slot._id,
    amenityId: amenity._id,
    amenityName: amenity.name,
    action: ACTIVITY_ACTION.SLOTS_REGENERATED,
    actor: g.actor,
    newValue: { dayOfWeek: slot.dayOfWeek, startTime: slot.startTime, endTime: slot.endTime },
    note: "Custom slot saved",
  });

  return created({ slot });
});

// DELETE /api/amenities/:id/slots — delete specific slots, or wipe the whole
// grid. Pass { ids: [...] } in the body to delete just those (the "select
// slots, then delete" flow); with no body it clears everything — generated
// slots by default, plus hand-added ones too if ?includeCustom=1 is set.
export const DELETE = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.MANAGE_SLOTS);
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid amenity id");

  const amenity = await Amenity.findOne({ _id: id, societyId: g.societyId, isDeleted: false }).lean();
  if (!amenity) return fail(404, "Amenity not found");

  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.filter(isId) : null;

  let filter;
  if (ids && ids.length) {
    filter = { amenityId: id, societyId: g.societyId, _id: { $in: ids } };
  } else {
    const includeCustom = new URL(request.url).searchParams.get("includeCustom") === "1";
    filter = { amenityId: id, societyId: g.societyId, ...(includeCustom ? {} : { isCustom: { $ne: true } }) };
  }

  const { deletedCount } = await AmenityTimeSlot.deleteMany(filter);

  await logAmenityActivity({
    societyId: g.societyId,
    entityType: "SLOT",
    entityId: amenity._id,
    amenityId: amenity._id,
    amenityName: amenity.name,
    action: ACTIVITY_ACTION.SLOTS_REGENERATED,
    actor: g.actor,
    oldValue: { deleted: deletedCount, ids: ids || null },
    note: `Cleared ${deletedCount} slot${deletedCount === 1 ? "" : "s"}`,
  });

  return ok({ deleted: deletedCount });
});

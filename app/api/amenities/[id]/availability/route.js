import Amenity from "@/models/amenities/Amenity";
import AmenityAvailability from "@/models/amenities/AmenityAvailability";
import { availabilityReplaceSchema } from "@/lib/amenities/schemas";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION } from "@/lib/amenities/constants";
import { getWeeklyGrid } from "@/lib/amenities/availability";
import { regenerateSlots } from "@/lib/amenities/slotEngine";
import { CAPABILITY, gate, ok, fail, zodFail, isId, withAmenityRoute } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.VIEW_AMENITIES);
  if (!g.ok) return g.response;

  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid amenity id");

  const amenity = await Amenity.findOne({ _id: id, societyId: g.societyId, isDeleted: false }).lean();
  if (!amenity) return fail(404, "Amenity not found");

  const closures = await AmenityAvailability.find({ amenityId: id, type: "CLOSURE", isActive: true })
    .sort({ startDate: 1 })
    .lean();

  // Always seven rows, closed days included, so the UI renders a stable grid.
  return ok({ weekly: await getWeeklyGrid(id, amenity), closures });
});

// PUT /api/amenities/[id]/availability
// Replaces the weekly opening-hours grid. Multiple windows per day are supported
// (a clubhouse open 06:00-10:00 and 16:00-22:00 is normal), which is why this is
// a separate collection rather than one opening/closing pair on the amenity.
export const PUT = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.MANAGE_AVAILABILITY);
  if (!g.ok) return g.response;

  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid amenity id");

  const parsed = availabilityReplaceSchema.safeParse(await request.json());
  if (!parsed.success) return zodFail(parsed);
  const { weekly, regenerateSlots: rebuild = true } = parsed.data;

  const amenity = await Amenity.findOne({ _id: id, societyId: g.societyId, isDeleted: false }).lean();
  if (!amenity) return fail(404, "Amenity not found");

  // Overlapping windows on one day would make "is it open now" ambiguous and
  // would generate duplicate slots.
  const byDay = new Map();
  for (const win of weekly) {
    const list = byDay.get(win.dayOfWeek) || [];
    list.push(win);
    byDay.set(win.dayOfWeek, list);
  }
  for (const [day, windows] of byDay) {
    const sorted = [...windows].sort((a, b) => a.openTime.localeCompare(b.openTime));
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].openTime < sorted[i - 1].closeTime) {
        return fail(422,
          `Two opening windows overlap on the same day (${sorted[i - 1].openTime}-${sorted[i - 1].closeTime} and ${sorted[i].openTime}-${sorted[i].closeTime}).`,
          { dayOfWeek: day });
      }
    }
  }

  const previous = await AmenityAvailability.find({ amenityId: id, type: "WEEKLY" }).lean();

  // Only the weekly rows are replaced — dated closures are untouched, so
  // rewriting opening hours never silently reopens a holiday.
  await AmenityAvailability.deleteMany({ amenityId: id, type: "WEEKLY" });
  if (weekly.length) {
    await AmenityAvailability.insertMany(weekly.map((win) => ({
      societyId: g.societyId,
      amenityId: id,
      type: "WEEKLY",
      dayOfWeek: win.dayOfWeek,
      openTime: win.openTime,
      closeTime: win.closeTime,
      isActive: win.isActive !== false,
    })));
  }

  // Keep the amenity's summary fields in step with the grid so list views and
  // the resident app show the right headline hours.
  const days = [...new Set(weekly.filter((wk) => wk.isActive !== false).map((wk) => wk.dayOfWeek))].sort();
  const opens = weekly.map((wk) => wk.openTime).sort();
  const closes = weekly.map((wk) => wk.closeTime).sort();
  const updated = await Amenity.findByIdAndUpdate(
    id,
    {
      $set: {
        operatingDays: days,
        ...(opens.length ? { openingTime: opens[0], closingTime: closes[closes.length - 1] } : {}),
        updatedBy: g.actor.userId,
      },
    },
    { new: true },
  ).lean();

  let slots = null;
  if (rebuild && updated.slotPolicy?.enabled) {
    slots = await regenerateSlots({ amenity: updated, days }).catch((err) => ({ error: err.message }));
  }

  await logAmenityActivity({
    societyId: g.societyId,
    entityType: "AVAILABILITY",
    entityId: id,
    amenityId: id,
    amenityName: amenity.name,
    action: ACTIVITY_ACTION.AVAILABILITY_UPDATED,
    actor: g.actor,
    oldValue: { windows: previous.map((p) => ({ d: p.dayOfWeek, o: p.openTime, c: p.closeTime })) },
    newValue: { windows: weekly.map((p) => ({ d: p.dayOfWeek, o: p.openTime, c: p.closeTime })) },
  });

  return ok({
    weekly: await getWeeklyGrid(id, updated),
    amenity: updated,
    ...(slots?.created != null ? { slotsRebuilt: slots.created } : {}),
    ...(slots?.error ? { slotWarning: slots.error } : {}),
  });
});

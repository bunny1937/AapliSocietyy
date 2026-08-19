import Amenity from "@/models/amenities/Amenity";
import AmenityCategory from "@/models/amenities/AmenityCategory";
import AmenityRule from "@/models/amenities/AmenityRule";
import AmenityTimeSlot from "@/models/amenities/AmenityTimeSlot";
import AmenityMaintenance from "@/models/amenities/AmenityMaintenance";
import AmenityAttendance from "@/models/amenities/AmenityAttendance";
import AmenityQrToken from "@/models/amenities/AmenityQrToken";
import AmenityAvailability from "@/models/amenities/AmenityAvailability";
import { amenityUpdateSchema } from "@/lib/amenities/schemas";
import { logAmenityActivity, logUpdate } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION, MAINTENANCE_STATUS } from "@/lib/amenities/constants";
import { capacitySnapshot } from "@/lib/amenities/attendanceService";
import { resolveEffectiveStatus } from "@/lib/amenities/availability";
import { regenerateSlots } from "@/lib/amenities/slotEngine";
import { getSettings } from "@/lib/amenities/settingsService";
import { buildQrPayloadForDisplay } from "@/lib/amenities/qrService";
import { CAPABILITY, gate, ok, fail, zodFail, isId, withAmenityRoute } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/amenities/[id]
// The full configuration screen in one request — the admin detail page needs all
// of it at once, and six round trips would render the tabs progressively.
export const GET = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.VIEW_AMENITIES);
  if (!g.ok) return g.response;

  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid amenity id");

  const amenity = await Amenity.findOne({ _id: id, societyId: g.societyId, isDeleted: false }).lean();
  if (!amenity) return fail(404, "Amenity not found");

  const settings = await getSettings(g.societyId);

  const [rules, slots, weekly, maintenance, closures, activeQr, openNow, effective] = await Promise.all([
    AmenityRule.find({ amenityId: id, isActive: true }).sort({ kind: 1, displayOrder: 1 }).lean(),
    AmenityTimeSlot.find({ amenityId: id }).sort({ dayOfWeek: 1, startMinutes: 1 }).lean(),
    // Raw WEEKLY rows, not the computed display grid (getWeeklyGrid) - the
    // admin edit form (app/admin/amenities/[id]/PageClient.js) filters this
    // by `r.type === "WEEKLY"` and reads `r.dayOfWeek/openTime/closeTime`
    // directly to hydrate its editable draft. getWeeklyGrid()'s output has
    // no `type` field at all, so that filter always came back empty and the
    // form showed "No weekly hours set" with every day Closed regardless of
    // what was actually saved.
    AmenityAvailability.find({ amenityId: id, type: "WEEKLY", isActive: true })
      .sort({ dayOfWeek: 1, openTime: 1 })
      .lean(),
    AmenityMaintenance.find({ amenityId: id }).sort({ startDate: -1 }).limit(20).lean(),
    AmenityAvailability.find({ amenityId: id, type: "CLOSURE", isActive: true }).sort({ startDate: -1 }).lean(),
    AmenityQrToken.findOne({ amenityId: id, isActive: true }).lean(),
    AmenityAttendance.countDocuments({ amenityId: id, timeOut: null }),
    resolveEffectiveStatus({ amenity, timezone: settings.timezone }),
  ]);

  return ok({
    amenity: {
      ...amenity,
      capacitySnapshot: capacitySnapshot(amenity),
      effectiveStatus: effective,
      openCheckIns: openNow,
    },
    // Grouped for the four rule columns in the UI.
    rules: {
      RULE: rules.filter((r) => r.kind === "RULE"),
      DO: rules.filter((r) => r.kind === "DO"),
      DONT: rules.filter((r) => r.kind === "DONT"),
      INSTRUCTION: rules.filter((r) => r.kind === "INSTRUCTION"),
    },
    slots,
    weekly,
    availability: weekly,
    maintenance,
    closures,
    qr: activeQr ? buildQrPayloadForDisplay(activeQr) : null,
  });
});

// PATCH /api/amenities/[id]
//
// Status is deliberately NOT accepted here. A status change fans out a
// society-wide notification and must go through POST /[id]/status so it can never
// happen as an invisible side effect of renaming an amenity.
export const PATCH = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.MANAGE_AMENITIES);
  if (!g.ok) return g.response;

  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid amenity id");

  const raw = await request.json();
  if (raw?.status) {
    return fail(422, "Use the change-status action to open or close an amenity so residents are notified.");
  }

  const parsed = amenityUpdateSchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed);
  const body = parsed.data;

  const before = await Amenity.findOne({ _id: id, societyId: g.societyId, isDeleted: false }).lean();
  if (!before) return fail(404, "Amenity not found");

  // Reducing capacity below the number of people currently inside would make
  // occupancy read over 100% and block everyone until the room emptied.
  if (body.capacity && body.capacity.unlimited === false && body.capacity.maxOccupancy) {
    if (body.capacity.maxOccupancy < (before.liveOccupancy || 0)) {
      return fail(409,
        `There are ${before.liveOccupancy} people checked in right now. Set the maximum to ${before.liveOccupancy} or higher, or wait until the amenity is empty.`,
        { liveOccupancy: before.liveOccupancy });
    }
  }

  let categoryName = before.categoryName;
  if (body.categoryId && String(body.categoryId) !== String(before.categoryId)) {
    const category = await AmenityCategory.findOne({
      _id: body.categoryId, societyId: g.societyId, isDeleted: false,
    }).select("_id name").lean();
    if (!category) return fail(404, "That category could not be found");
    categoryName = category.name;
    // Keep both category counters honest when an amenity is moved.
    await Promise.all([
      AmenityCategory.findByIdAndUpdate(before.categoryId, { $inc: { amenityCount: -1 } }),
      AmenityCategory.findByIdAndUpdate(body.categoryId, { $inc: { amenityCount: 1 } }),
    ]);
  }

  if (body.access?.audience === "CUSTOM") {
    const settings = await getSettings(g.societyId);
    const known = settings.customAccessRoles || [];
    const unknown = (body.access.customRoles || []).filter((r) => !known.includes(r));
    if (unknown.length) {
      return fail(422, `These roles are not configured for your society: ${unknown.join(", ")}`, {
        availableRoles: known,
      });
    }
  }

  // Merge sub-documents instead of replacing them, so PATCHing one slot field
  // does not reset the rest of the policy to defaults.
  const update = { ...body, categoryName, updatedBy: g.actor.userId };
  for (const key of ["access", "capacity", "slotPolicy", "visitorPolicy", "contactPerson"]) {
    if (body[key]) update[key] = { ...(before[key] || {}), ...body[key] };
  }

  const after = await Amenity.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();

  // Slot geometry changed — rebuild the grid, preserving admin-made custom slots.
  const policyChanged = body.slotPolicy || body.openingTime || body.closingTime || body.operatingDays;
  let slots = null;
  if (policyChanged && after.slotPolicy?.enabled) {
    slots = await regenerateSlots({ amenity: after }).catch((err) => ({ error: err.message }));
  }
  // Slots switched off: deactivate rather than delete, so historical attendance
  // rows that reference a slot can still resolve its label.
  if (body.slotPolicy?.enabled === false) {
    await AmenityTimeSlot.updateMany({ amenityId: id }, { $set: { isActive: false } });
  }

  await logUpdate({
    societyId: g.societyId,
    entityType: "AMENITY",
    entityId: id,
    amenityId: id,
    amenityName: after.name,
    action: ACTIVITY_ACTION.AMENITY_UPDATED,
    actor: g.actor,
    prev: before,
    next: update,
  });

  return ok({
    amenity: { ...after, capacitySnapshot: capacitySnapshot(after) },
    ...(slots?.created != null ? { slotsRebuilt: slots.created } : {}),
    ...(slots?.error ? { slotWarning: slots.error } : {}),
  });
});

// DELETE /api/amenities/[id]
// Soft delete only. Attendance, incidents and analytics all reference the
// amenity, and the brief requires those histories to survive permanently.
export const DELETE = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.MANAGE_AMENITIES);
  if (!g.ok) return g.response;

  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid amenity id");

  const amenity = await Amenity.findOne({ _id: id, societyId: g.societyId, isDeleted: false }).lean();
  if (!amenity) return fail(404, "Amenity not found");

  const openCheckIns = await AmenityAttendance.countDocuments({ amenityId: id, timeOut: null });
  if (openCheckIns > 0) {
    return fail(409,
      `${openCheckIns} ${openCheckIns === 1 ? "person is" : "people are"} still checked in. Check them out before deleting this amenity.`,
      { openCheckIns });
  }

  const activeMaintenance = await AmenityMaintenance.countDocuments({
    amenityId: id, status: MAINTENANCE_STATUS.IN_PROGRESS,
  });

  await Amenity.findByIdAndUpdate(id, {
    $set: { isDeleted: true, deletedAt: new Date(), isActive: false, updatedBy: g.actor.userId },
  });
  await AmenityCategory.findByIdAndUpdate(amenity.categoryId, { $inc: { amenityCount: -1 } });
  // Retire the QR sticker so a scan cannot resurrect a deleted amenity.
  await AmenityQrToken.updateMany(
    { amenityId: id, isActive: true },
    { $set: { isActive: false, revokedAt: new Date(), revokedBy: g.actor.userId } },
  );

  await logAmenityActivity({
    societyId: g.societyId,
    entityType: "AMENITY",
    entityId: id,
    amenityId: id,
    amenityName: amenity.name,
    action: ACTIVITY_ACTION.AMENITY_DELETED,
    actor: g.actor,
    oldValue: { name: amenity.name, status: amenity.status },
    note: activeMaintenance ? "Deleted with maintenance in progress" : "",
  });

  return ok({ deleted: true, historyRetained: true });
});

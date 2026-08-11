import Amenity from "@/models/amenities/Amenity";
import AmenityMaintenance from "@/models/amenities/AmenityMaintenance";
import { maintenanceReopenSchema } from "@/lib/amenities/schemas";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION, AMENITY_STATUS, MAINTENANCE_STATUS } from "@/lib/amenities/constants";
import { notifyAmenityReopened } from "@/lib/amenities/notify";
import { recomputeDay } from "@/lib/amenities/analyticsService";
import { getTimezone } from "@/lib/amenities/settingsService";
import { dayKey } from "@/lib/amenities/time";
import { gate, ok, fail, zodFail, isId, withAmenityRoute, CAPABILITY } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/amenities/maintenance/:id/reopen — "reopen early".
//
// Closes the window at *now* rather than deleting it, so recorded downtime
// matches reality (the amenity really was shut for those hours).
export const POST = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.MANAGE_MAINTENANCE);
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid maintenance id");

  const parsed = maintenanceReopenSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return zodFail(parsed);

  const record = await AmenityMaintenance.findOne({ _id: id, societyId: g.societyId });
  if (!record) return fail(404, "Maintenance record not found");
  if (record.status === MAINTENANCE_STATUS.COMPLETED) {
    return fail(409, "This maintenance window is already complete");
  }
  if (record.status === MAINTENANCE_STATUS.CANCELLED) {
    return fail(409, "This maintenance window was cancelled");
  }

  const now = new Date();
  const scheduledEnd = record.endDate;
  const startedYet = record.startDate <= now;

  // Never started: cancel it. Already running: complete it early.
  record.status = startedYet ? MAINTENANCE_STATUS.COMPLETED : MAINTENANCE_STATUS.CANCELLED;
  record.reopenedEarly = startedYet && now < scheduledEnd;
  record.actualEndDate = startedYet ? now : null;
  record.completionNotes = parsed.data.notes || "";
  record.updatedBy = g.actor.userId;
  record.updatedByName = g.actor.name;
  if (startedYet && now < scheduledEnd) record.endDate = now;
  await record.save();

  const amenity = await Amenity.findOne({ _id: record.amenityId, societyId: g.societyId });
  let restoredStatus = null;
  if (amenity) {
    // Restore whatever the amenity was before maintenance took over, defaulting
    // to OPEN. A permanently closed amenity must not silently reopen.
    const restore =
      record.previousAmenityStatus && record.previousAmenityStatus !== AMENITY_STATUS.UNDER_MAINTENANCE
        ? record.previousAmenityStatus
        : AMENITY_STATUS.OPEN;
    amenity.status = parsed.data.restoreStatus || restore;
    amenity.activeMaintenanceId = null;
    amenity.statusNote = "";
    amenity.statusChangedAt = now;
    amenity.statusChangedBy = g.actor.userId;
    await amenity.save();
    restoredStatus = amenity.status;
  }

  await logAmenityActivity({
    societyId: g.societyId,
    entityType: "MAINTENANCE",
    entityId: record._id,
    amenityId: record.amenityId,
    amenityName: record.amenityName,
    action: record.reopenedEarly ? ACTIVITY_ACTION.MAINTENANCE_REOPENED : ACTIVITY_ACTION.MAINTENANCE_COMPLETED,
    actor: g.actor,
    changedFields: ["status", "endDate"],
    oldValue: { status: MAINTENANCE_STATUS.IN_PROGRESS, endDate: scheduledEnd },
    newValue: { status: record.status, endDate: record.endDate, restoredStatus },
    note: parsed.data.notes || "",
  });

  if (amenity && parsed.data.notify !== false && amenity.status === AMENITY_STATUS.OPEN) {
    await notifyAmenityReopened({ societyId: g.societyId, amenity: amenity.toObject(), actor: g.actor });
  }

  // Downtime for today changed, so the daily rollup is stale.
  if (startedYet) {
    const timezone = await getTimezone(g.societyId);
    await recomputeDay({
      societyId: g.societyId,
      amenityId: record.amenityId,
      dayKeyStr: dayKey(now, timezone),
      timezone,
    }).catch(() => {});
  }

  return ok({ maintenance: record.toObject(), amenityStatus: restoredStatus });
});

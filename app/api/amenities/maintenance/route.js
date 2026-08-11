import Amenity from "@/models/amenities/Amenity";
import AmenityMaintenance from "@/models/amenities/AmenityMaintenance";
import { maintenanceCreateSchema } from "@/lib/amenities/schemas";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION, AMENITY_STATUS, MAINTENANCE_STATUS } from "@/lib/amenities/constants";
import { findOverlappingMaintenance } from "@/lib/amenities/availability";
import { notifyMaintenanceScheduled } from "@/lib/amenities/notify";
import {
  gate, ok, created, fail, zodFail, isId, paging, pageMeta,
  withAmenityRoute, CAPABILITY,
} from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/amenities/maintenance?amenityId=&status=&from=&to=&scope=calendar
// Powers both the maintenance calendar and the per-amenity history table.
export const GET = withAmenityRoute(async (request) => {
  const g = await gate(request, CAPABILITY.VIEW_AMENITIES);
  if (!g.ok) return g.response;

  const sp = new URL(request.url).searchParams;
  const { page, limit, skip } = paging(sp, { defaultLimit: 50 });

  const filter = { societyId: g.societyId };
  if (isId(sp.get("amenityId"))) filter.amenityId = sp.get("amenityId");
  if (sp.get("status")) filter.status = sp.get("status");

  // Calendar windows need every record that *overlaps* the month, not only the
  // ones starting in it — a two-week closure spanning month end must appear in
  // both months.
  const from = sp.get("from") ? new Date(sp.get("from")) : null;
  const to = sp.get("to") ? new Date(sp.get("to")) : null;
  if (from && to) {
    filter.startDate = { $lte: to };
    filter.endDate = { $gte: from };
  }

  const [records, total] = await Promise.all([
    AmenityMaintenance.find(filter).sort({ startDate: -1 }).skip(skip).limit(limit).lean(),
    AmenityMaintenance.countDocuments(filter),
  ]);

  return ok({ maintenance: records, pagination: pageMeta({ page, limit, total }) });
});

// POST /api/amenities/maintenance — schedule a window.
//
// If the window is already live, the amenity flips to UNDER_MAINTENANCE now;
// future windows only set the status when they begin (handled by the effective
// status resolver, so no cron is required for correctness).
export const POST = withAmenityRoute(async (request) => {
  const g = await gate(request, CAPABILITY.MANAGE_MAINTENANCE);
  if (!g.ok) return g.response;

  const parsed = maintenanceCreateSchema.safeParse(await request.json());
  if (!parsed.success) return zodFail(parsed);

  const { amenityId, startDate, endDate, reason, notes = "", notify = true } = parsed.data;

  const amenity = await Amenity.findOne({ _id: amenityId, societyId: g.societyId, isDeleted: false });
  if (!amenity) return fail(404, "Amenity not found");

  const start = new Date(startDate);
  const end = new Date(endDate);

  // Overlapping windows would make "which maintenance is active" ambiguous and
  // double-count downtime in analytics.
  const clash = await findOverlappingMaintenance({ amenityId, startDate: start, endDate: end });
  if (clash) {
    return fail(409, `This overlaps maintenance already scheduled from ${new Date(clash.startDate).toLocaleString("en-IN")} to ${new Date(clash.endDate).toLocaleString("en-IN")}`, {
      conflictId: String(clash._id),
    });
  }

  const now = new Date();
  const isLive = start <= now && end > now;

  const record = await AmenityMaintenance.create({
    societyId: g.societyId,
    amenityId,
    amenityName: amenity.name,
    startDate: start,
    endDate: end,
    reason,
    notes,
    status: isLive ? MAINTENANCE_STATUS.IN_PROGRESS : MAINTENANCE_STATUS.SCHEDULED,
    previousAmenityStatus: amenity.status,
    createdBy: g.actor.userId,
    createdByName: g.actor.name,
  });

  if (isLive) {
    amenity.status = AMENITY_STATUS.UNDER_MAINTENANCE;
    amenity.activeMaintenanceId = record._id;
    amenity.statusChangedAt = now;
    amenity.statusChangedBy = g.actor.userId;
    amenity.statusNote = reason;
    await amenity.save();
  }

  await logAmenityActivity({
    societyId: g.societyId,
    entityType: "MAINTENANCE",
    entityId: record._id,
    amenityId: amenity._id,
    amenityName: amenity.name,
    action: ACTIVITY_ACTION.MAINTENANCE_SCHEDULED,
    actor: g.actor,
    newValue: { startDate: start, endDate: end, reason, status: record.status },
  });

  if (notify) {
    await notifyMaintenanceScheduled({ societyId: g.societyId, amenity, maintenance: record, actor: g.actor });
  }

  return created({ maintenance: record, amenityStatus: amenity.status });
});

import Amenity from "@/models/amenities/Amenity";
import AmenityMaintenance from "@/models/amenities/AmenityMaintenance";
import { maintenanceUpdateSchema } from "@/lib/amenities/schemas";
import { logUpdate } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION, MAINTENANCE_STATUS } from "@/lib/amenities/constants";
import { findOverlappingMaintenance } from "@/lib/amenities/availability";
import { notifyMaintenanceUpdated } from "@/lib/amenities/notify";
import { gate, ok, fail, zodFail, isId, withAmenityRoute, CAPABILITY } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH — edit a window. Completed and cancelled records are frozen: the brief
// requires maintenance history to be retained permanently, and rewriting a past
// window would silently rewrite reported downtime.
export const PATCH = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.MANAGE_MAINTENANCE);
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid maintenance id");

  const parsed = maintenanceUpdateSchema.safeParse(await request.json());
  if (!parsed.success) return zodFail(parsed);

  const prev = await AmenityMaintenance.findOne({ _id: id, societyId: g.societyId }).lean();
  if (!prev) return fail(404, "Maintenance record not found");
  if ([MAINTENANCE_STATUS.COMPLETED, MAINTENANCE_STATUS.CANCELLED].includes(prev.status)) {
    return fail(409, "This maintenance record is closed and cannot be edited. Schedule a new window instead.");
  }

  const start = parsed.data.startDate ? new Date(parsed.data.startDate) : new Date(prev.startDate);
  const end = parsed.data.endDate ? new Date(parsed.data.endDate) : new Date(prev.endDate);
  if (end <= start) return fail(422, "End must be after start");

  const clash = await findOverlappingMaintenance({
    amenityId: prev.amenityId,
    startDate: start,
    endDate: end,
    excludeId: id,
  });
  if (clash) return fail(409, "This overlaps another scheduled maintenance window");

  const next = await AmenityMaintenance.findOneAndUpdate(
    { _id: id, societyId: g.societyId },
    {
      $set: {
        ...parsed.data,
        startDate: start,
        endDate: end,
        updatedBy: g.actor.userId,
        updatedByName: g.actor.name,
      },
    },
    { new: true },
  ).lean();

  await logUpdate({
    societyId: g.societyId,
    entityType: "MAINTENANCE",
    entityId: next._id,
    amenityId: next.amenityId,
    amenityName: next.amenityName,
    action: ACTIVITY_ACTION.MAINTENANCE_UPDATED,
    actor: g.actor,
    prev,
    next: { startDate: start, endDate: end, reason: next.reason, notes: next.notes },
  });

  if (parsed.data.notify !== false) {
    const amenity = await Amenity.findById(next.amenityId).lean();
    if (amenity) {
      await notifyMaintenanceUpdated({ societyId: g.societyId, amenity, maintenance: next, actor: g.actor });
    }
  }

  return ok({ maintenance: next });
});

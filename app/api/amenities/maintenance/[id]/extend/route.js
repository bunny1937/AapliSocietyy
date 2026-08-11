import Amenity from "@/models/amenities/Amenity";
import AmenityMaintenance from "@/models/amenities/AmenityMaintenance";
import { maintenanceExtendSchema } from "@/lib/amenities/schemas";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION, MAINTENANCE_STATUS } from "@/lib/amenities/constants";
import { findOverlappingMaintenance } from "@/lib/amenities/availability";
import { notifyMaintenanceExtended } from "@/lib/amenities/notify";
import { gate, ok, fail, zodFail, isId, withAmenityRoute, CAPABILITY } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/amenities/maintenance/:id/extend
//
// A first-class action rather than a PATCH of endDate: extensions are appended
// to an audit trail on the record, so residents and auditors can see that a
// three-day repair became nine days across three extensions.
export const POST = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.MANAGE_MAINTENANCE);
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid maintenance id");

  const parsed = maintenanceExtendSchema.safeParse(await request.json());
  if (!parsed.success) return zodFail(parsed);

  const record = await AmenityMaintenance.findOne({ _id: id, societyId: g.societyId });
  if (!record) return fail(404, "Maintenance record not found");
  if ([MAINTENANCE_STATUS.COMPLETED, MAINTENANCE_STATUS.CANCELLED].includes(record.status)) {
    return fail(409, "This maintenance window is already closed");
  }

  const newEnd = new Date(parsed.data.newEndDate);
  if (newEnd <= record.endDate) {
    return fail(422, "The new end date must be later than the current end date");
  }

  const clash = await findOverlappingMaintenance({
    amenityId: record.amenityId,
    startDate: record.startDate,
    endDate: newEnd,
    excludeId: id,
  });
  if (clash) return fail(409, "Extending this far overlaps another scheduled maintenance window");

  const previousEnd = record.endDate;
  record.extensions.push({
    previousEndDate: previousEnd,
    newEndDate: newEnd,
    reason: parsed.data.reason,
    extendedBy: g.actor.userId,
    extendedByName: g.actor.name,
    extendedAt: new Date(),
  });
  record.endDate = newEnd;
  record.updatedBy = g.actor.userId;
  record.updatedByName = g.actor.name;
  if (parsed.data.notes) record.notes = parsed.data.notes;
  await record.save();

  await logAmenityActivity({
    societyId: g.societyId,
    entityType: "MAINTENANCE",
    entityId: record._id,
    amenityId: record.amenityId,
    amenityName: record.amenityName,
    action: ACTIVITY_ACTION.MAINTENANCE_EXTENDED,
    actor: g.actor,
    changedFields: ["endDate"],
    oldValue: { endDate: previousEnd },
    newValue: { endDate: newEnd, reason: parsed.data.reason },
    note: parsed.data.reason,
  });

  if (parsed.data.notify !== false) {
    const amenity = await Amenity.findById(record.amenityId).lean();
    if (amenity) {
      await notifyMaintenanceExtended({
        societyId: g.societyId,
        amenity,
        maintenance: record.toObject(),
        previousEnd,
        actor: g.actor,
      });
    }
  }

  return ok({ maintenance: record.toObject() });
});

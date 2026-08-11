import Amenity from "@/models/amenities/Amenity";
import AmenityAvailability from "@/models/amenities/AmenityAvailability";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION } from "@/lib/amenities/constants";
import { CAPABILITY, gate, ok, fail, isId, withAmenityRoute } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE /api/amenities/[id]/closures/[closureId]
// Cancels a closure. Deactivated rather than deleted so the activity log's
// reference still resolves.
export const DELETE = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.MANAGE_AVAILABILITY);
  if (!g.ok) return g.response;

  const { id, closureId } = await params;
  if (!isId(id) || !isId(closureId)) return fail(400, "Invalid id");

  const amenity = await Amenity.findOne({ _id: id, societyId: g.societyId, isDeleted: false })
    .select("name").lean();
  if (!amenity) return fail(404, "Amenity not found");

  const closure = await AmenityAvailability.findOneAndUpdate(
    { _id: closureId, amenityId: id, type: "CLOSURE", isActive: true },
    { $set: { isActive: false } },
    { new: false },
  ).lean();
  if (!closure) return fail(404, "Closure not found");

  await logAmenityActivity({
    societyId: g.societyId,
    entityType: "AVAILABILITY",
    entityId: closureId,
    amenityId: id,
    amenityName: amenity.name,
    action: ACTIVITY_ACTION.CLOSURE_REMOVED,
    actor: g.actor,
    oldValue: {
      closureType: closure.closureType,
      startDate: closure.startDate,
      endDate: closure.endDate,
      reason: closure.reason,
    },
  });

  return ok({ removed: true });
});

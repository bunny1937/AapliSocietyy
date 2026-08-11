import Amenity from "@/models/amenities/Amenity";
import AmenityAttendance from "@/models/amenities/AmenityAttendance";
import { capacitySnapshot, recomputeOccupancy, autoCheckoutStale } from "@/lib/amenities/attendanceService";
import { getSettings } from "@/lib/amenities/settingsService";
import { gate, ok, fail, isId, withAmenityRoute, CAPABILITY } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET — live occupancy panel: who is inside right now.
export const GET = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.VIEW_AMENITIES);
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid amenity id");

  const amenity = await Amenity.findOne({ _id: id, societyId: g.societyId, isDeleted: false }).lean();
  if (!amenity) return fail(404, "Amenity not found");

  const inside = await AmenityAttendance.find({ amenityId: id, timeOut: null })
    .select("attendeeType residentName flatNo visitorName timeIn checkInMethod isOverride memberId")
    .sort({ timeIn: -1 })
    .lean();

  return ok({
    capacity: capacitySnapshot(amenity),
    inside,
    // The counter and the row count can diverge if a process died mid-write;
    // surfacing both lets the UI offer a one-click repair instead of hiding it.
    counterDrift: (amenity.liveOccupancy || 0) !== inside.length,
  });
});

// POST — maintenance actions on the counter: recompute from attendance rows,
// and/or close sessions nobody checked out of.
export const POST = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.ADJUST_ATTENDANCE);
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid amenity id");

  const body = await request.json().catch(() => ({}));
  const amenity = await Amenity.findOne({ _id: id, societyId: g.societyId, isDeleted: false }).lean();
  if (!amenity) return fail(404, "Amenity not found");

  const settings = await getSettings(g.societyId);
  const result = {};

  if (body.autoCheckout) {
    result.autoCheckout = await autoCheckoutStale({
      societyId: g.societyId,
      amenityId: id,
      afterMins: settings?.autoCheckoutAfterMins || 240,
      timezone: settings?.timezone,
    });
  }

  result.liveOccupancy = await recomputeOccupancy(id);
  return ok(result);
});

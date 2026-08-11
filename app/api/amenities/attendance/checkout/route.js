import AmenityAttendance from "@/models/amenities/AmenityAttendance";
import Amenity from "@/models/amenities/Amenity";
import { checkOutSchema } from "@/lib/amenities/schemas";
import { checkOut } from "@/lib/amenities/attendanceService";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION } from "@/lib/amenities/constants";
import { gate, ok, fail, zodFail, withAmenityRoute, CAPABILITY, serviceError } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/amenities/attendance/checkout
// Accepts either an attendance id (row clicked in the register) or an
// amenityId + memberId pair (guard closing out a resident by name).
export const POST = withAmenityRoute(async (request) => {
  const g = await gate(request, CAPABILITY.RECORD_ATTENDANCE);
  if (!g.ok) return g.response;

  const parsed = checkOutSchema.safeParse(await request.json());
  if (!parsed.success) return zodFail(parsed);

  const query = { societyId: g.societyId, timeOut: null };
  if (parsed.data.attendanceId) query._id = parsed.data.attendanceId;
  else {
    query.amenityId = parsed.data.amenityId;
    if (parsed.data.memberId) query.memberId = parsed.data.memberId;
    if (parsed.data.visitorPhone) query.visitorPhone = parsed.data.visitorPhone;
  }

  const open = await AmenityAttendance.findOne(query).sort({ timeIn: -1 }).lean();
  if (!open) return fail(404, "No open check-in found for this person");

  try {
    const record = await checkOut({
      societyId: g.societyId,
      attendanceId: open._id,
      method: "MANUAL",
      checkedOutBy: g.actor.userId,
      checkedOutByName: g.actor.name,
      actor: g.actor,
    });

    const amenity = await Amenity.findById(record.amenityId).select("name").lean();

    await logAmenityActivity({
      societyId: g.societyId,
      entityType: "ATTENDANCE",
      entityId: record._id,
      amenityId: record.amenityId,
      amenityName: amenity?.name || "",
      action: ACTIVITY_ACTION.ATTENDANCE_CHECKED_OUT,
      actor: g.actor,
      newValue: { timeOut: record.timeOut, durationMins: record.durationMins },
    });

    return ok({ attendance: record });
  } catch (err) {
    return serviceError(err);
  }
});

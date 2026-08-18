import { withRoute, json } from "@/lib/v1/http";
import connectDB from "@/lib/mongodb";
import { z } from "zod";
import AmenityAttendance from "@/models/amenities/AmenityAttendance";
import Amenity from "@/models/amenities/Amenity";
import AmenityMemberCard from "@/models/amenities/AmenityMemberCard";
import { clubhouseContext } from "@/lib/amenities/clubhouseContext";
import { CAPABILITY } from "@/lib/amenities/permissions";
import { checkOut, CheckInError } from "@/lib/amenities/attendanceService";
import { STATUS_BY_CODE } from "@/lib/amenities/apiHelpers";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { notifyCheckedOutByStaff } from "@/lib/amenities/notify";
import { ACTIVITY_ACTION, CHECKIN_METHOD } from "@/lib/amenities/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  attendanceId: z.string().regex(/^[a-f\d]{24}$/i, "Select a member to check out"),
});

// POST /api/v1/clubhouse/attendance/check-out
//
// Manager-initiated checkout for one specific active member. The resident's own
// checkout is untouched and still lives at /api/v1/amenities/qr/check-out —
// both end in the same attendanceService.checkOut(), which owns duration,
// occupancy release and session state. This route does not compute any of them.
export const POST = withRoute(async (request) => {
  const ctx = await clubhouseContext(request, CAPABILITY.RECORD_ATTENDANCE);
  await connectDB();

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return json({ error: parsed.error.flatten() }, { status: 400 });

  // Scoped to the society before anything else: an attendance id from another
  // society must read as "not checked in here", never as a closeable session.
  const row = await AmenityAttendance.findOne({
    _id: parsed.data.attendanceId,
    societyId: ctx.societyId,
  }).lean();
  if (!row) return json({ ok: false, code: "NOT_FOUND", message: "Member could not be verified." }, { status: 404 });
  if (row.timeOut) {
    return json(
      { ok: false, code: "NOT_CHECKED_IN", message: "This member has already checked out." },
      { status: STATUS_BY_CODE.NOT_CHECKED_IN || 409 },
    );
  }

  try {
    const result = await checkOut({
      societyId: ctx.societyId,
      attendanceId: row._id,
      amenityId: row.amenityId,
      memberId: row.memberId,
      method: CHECKIN_METHOD.MANUAL,
      checkedOutBy: ctx.userId,
      checkedOutByName: ctx.name,
      actor: ctx.actor,
    });

    const amenity = await Amenity.findById(row.amenityId).select("_id name").lean();

    await logAmenityActivity({
      societyId: ctx.societyId,
      entityType: "ATTENDANCE",
      entityId: row._id,
      amenityId: row.amenityId,
      amenityName: row.amenityName,
      action: ACTIVITY_ACTION.ATTENDANCE_CHECK_OUT,
      actor: ctx.actor,
      newValue: {
        member: row.residentName,
        flat: row.flatNo,
        durationMins: result.attendance.durationMins,
        via: "CLUBHOUSE_DESK",
      },
      note: `Checked out by ${ctx.name || "Clubhouse Manager"}`,
    });

    // The resident is told their session was closed for them. Resolved from the
    // card rather than the attendance row because a family member's session is
    // recorded against the flat's member id, and the push has to reach whichever
    // account actually holds that card.
    const card = await AmenityMemberCard.findOne({
      memberId: row.memberId,
      holderName: row.residentName,
    })
      .select("userId")
      .lean();
    if (card?.userId && amenity) {
      await notifyCheckedOutByStaff({
        societyId: ctx.societyId,
        userId: card.userId,
        amenity,
        durationMins: result.attendance.durationMins,
        byName: ctx.name,
      });
    }

    return json({
      ok: true,
      attendance: {
        _id: result.attendance._id,
        memberName: row.residentName,
        flatLabel: row.flatNo,
        amenityName: row.amenityName,
        timeIn: result.attendance.timeIn,
        timeOut: result.attendance.timeOut,
        durationMins: result.attendance.durationMins,
      },
      capacity: result.capacity,
    });
  } catch (err) {
    if (err instanceof CheckInError) {
      return json(
        { ok: false, code: err.code, message: err.message },
        { status: STATUS_BY_CODE[err.code] || 409 },
      );
    }
    throw err;
  }
});

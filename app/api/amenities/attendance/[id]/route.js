import AmenityAttendance from "@/models/amenities/AmenityAttendance";
import { attendanceAdjustSchema } from "@/lib/amenities/schemas";
import { recomputeOccupancy } from "@/lib/amenities/attendanceService";
import { recomputeDay } from "@/lib/amenities/analyticsService";
import { getTimezone } from "@/lib/amenities/settingsService";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION } from "@/lib/amenities/constants";
import { gate, ok, fail, zodFail, isId, withAmenityRoute, CAPABILITY } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/amenities/attendance/:id — correct a mis-recorded session.
//
// Attendance is never deleted (brief requirement), so mistakes are corrected in
// place with the original values preserved in the activity log, plus an
// adjustment reason and adjuster stamped on the row itself.
export const PATCH = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.ADJUST_ATTENDANCE);
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid attendance id");

  const parsed = attendanceAdjustSchema.safeParse(await request.json());
  if (!parsed.success) return zodFail(parsed);

  const prev = await AmenityAttendance.findOne({ _id: id, societyId: g.societyId });
  if (!prev) return fail(404, "Attendance record not found");

  const timeIn = parsed.data.timeIn ? new Date(parsed.data.timeIn) : prev.timeIn;
  const timeOut =
    parsed.data.timeOut === null
      ? null
      : parsed.data.timeOut
        ? new Date(parsed.data.timeOut)
        : prev.timeOut;

  if (timeOut && timeOut <= timeIn) return fail(422, "Check-out must be after check-in");
  if (timeIn > new Date()) return fail(422, "Check-in time cannot be in the future");

  const before = {
    timeIn: prev.timeIn,
    timeOut: prev.timeOut,
    durationMins: prev.durationMins,
    notes: prev.notes,
  };

  prev.timeIn = timeIn;
  prev.timeOut = timeOut;
  prev.durationMins = timeOut ? Math.max(0, Math.round((timeOut - timeIn) / 60000)) : null;
  if (parsed.data.notes != null) prev.notes = parsed.data.notes;
  prev.adjustedBy = g.actor.userId;
  prev.adjustedAt = new Date();
  prev.adjustmentReason = parsed.data.reason;
  await prev.save();

  // Reopening or closing a session changes the live counter, and the day's
  // rollup no longer matches the underlying rows.
  await recomputeOccupancy(prev.amenityId);
  const timezone = await getTimezone(g.societyId);
  await recomputeDay({
    societyId: g.societyId,
    amenityId: prev.amenityId,
    dayKeyStr: prev.dayKey,
    timezone,
  }).catch(() => {});

  await logAmenityActivity({
    societyId: g.societyId,
    entityType: "ATTENDANCE",
    entityId: prev._id,
    amenityId: prev.amenityId,
    action: ACTIVITY_ACTION.ATTENDANCE_ADJUSTED,
    actor: g.actor,
    changedFields: ["timeIn", "timeOut", "durationMins"],
    oldValue: before,
    newValue: { timeIn: prev.timeIn, timeOut: prev.timeOut, durationMins: prev.durationMins },
    note: parsed.data.reason,
  });

  return ok({ attendance: prev.toObject() });
});

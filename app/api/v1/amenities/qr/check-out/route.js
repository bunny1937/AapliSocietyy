import { withRoute, json, ApiError, zodError } from "@/lib/v1/http";
import { getClaims } from "@/lib/v1/auth";
import connectDB from "@/lib/mongodb";
import AmenityAttendance from "@/models/amenities/AmenityAttendance";
import Amenity from "@/models/amenities/Amenity";
import { z } from "zod";
import { memberContext, requireCapability } from "@/lib/amenities/memberContext";
import { CAPABILITY } from "@/lib/amenities/permissions";
import { checkOut } from "@/lib/amenities/attendanceService";
import { verifyToken, recordScan } from "@/lib/amenities/qrService";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION, CHECKIN_METHOD } from "@/lib/amenities/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  token: z.string().min(6).optional(),
  amenityId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  attendanceId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
});

// POST /api/v1/amenities/qr/check-out
//
// Check-out accepts a scan *or* a plain amenity/attendance id. Requiring a scan
// to leave would trap people whose session is open but who have walked away
// from the sticker — and a stuck open session silently consumes capacity for
// everyone else.
export const POST = withRoute(async (request) => {
  const claims = await getClaims(request);
  await connectDB();
  const ctx = await memberContext(claims, request);
  requireCapability(ctx, CAPABILITY.SELF_CHECK_IN);

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return zodError(parsed);

  let amenityId = parsed.data.amenityId || null;
  let method = CHECKIN_METHOD.MANUAL;

  if (parsed.data.token) {
    const verification = await verifyToken({ societyId: ctx.societyId, raw: parsed.data.token });
    await recordScan({
      societyId: ctx.societyId,
      amenityId: verification.token?.amenityId || null,
      tokenId: verification.token?._id || null,
      tokenPrefix: verification.parsed?.prefix || "",
      result: verification.result,
      scannedBy: ctx.userId,
      scannedByName: ctx.member.name,
      scannedByRole: ctx.role,
      memberId: ctx.memberId,
      deviceInfo: ctx.actor.userAgent,
      ip: ctx.actor.ip,
      direction: "OUT",
    });
    if (verification.ok) {
      amenityId = verification.token.amenityId;
      method = CHECKIN_METHOD.QR;
    }
    // An unreadable code on the way out is not fatal — fall through and close
    // the session by id instead of stranding the resident.
  }

  const query = { societyId: ctx.societyId, memberId: ctx.memberId, timeOut: null };
  if (parsed.data.attendanceId) query._id = parsed.data.attendanceId;
  else if (amenityId) query.amenityId = amenityId;

  const open = await AmenityAttendance.findOne(query).sort({ timeIn: -1 }).lean();
  if (!open) throw new ApiError(404, "You do not have an open check-in here.");

  const record = await checkOut({
    societyId: ctx.societyId,
    attendanceId: open._id,
    method,
    checkedOutBy: ctx.userId,
    checkedOutByName: ctx.member.name,
    actor: ctx.actor,
  });

  const amenity = await Amenity.findById(record.amenityId).select("name").lean();

  await logAmenityActivity({
    societyId: ctx.societyId,
    entityType: "ATTENDANCE",
    entityId: record._id,
    amenityId: record.amenityId,
    amenityName: amenity?.name || "",
    // FIX: same undefined-constant bug as the check-in route above
    // (ATTENDANCE_CHECKED_OUT -> ATTENDANCE_CHECK_OUT).
    action: ACTIVITY_ACTION.ATTENDANCE_CHECK_OUT,
    actor: ctx.actor,
    newValue: { durationMins: record.durationMins, method, self: true },
  });

  return json({
    checkedOut: true,
    attendance: {
      _id: record._id,
      timeIn: record.timeIn,
      timeOut: record.timeOut,
      durationMins: record.durationMins,
    },
    amenity: { _id: record.amenityId, name: amenity?.name || "" },
    message: `Checked out after ${record.durationMins} min`,
  });
});

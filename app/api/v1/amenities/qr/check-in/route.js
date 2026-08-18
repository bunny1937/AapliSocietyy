import { withRoute, json, ApiError, zodError } from "@/lib/v1/http";
import { getClaims } from "@/lib/v1/auth";
import connectDB from "@/lib/mongodb";
import Amenity from "@/models/amenities/Amenity";
import { z } from "zod";
import { memberContext, requireCapability } from "@/lib/amenities/memberContext";
import { CAPABILITY } from "@/lib/amenities/permissions";
import { verifyToken, recordScan } from "@/lib/amenities/qrService";
import { checkIn, CheckInError } from "@/lib/amenities/attendanceService";
import { STATUS_BY_CODE } from "@/lib/amenities/apiHelpers";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION, CHECKIN_METHOD, ATTENDANCE_MODE } from "@/lib/amenities/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  token: z.string().min(6, "Scan a valid amenity QR code"),
  guestCount: z.number().int().min(0).max(20).optional(),
  eventId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
});

// POST /api/v1/amenities/qr/check-in
//
// The resident scans the amenity's QR sticker with their own phone. Unlike the
// staff scan endpoint, the attendee is taken from the authenticated token — a
// resident can only ever check *themselves* in, so a leaked QR image cannot be
// used to check in someone else.
//
// Eligibility is enforced here (not bypassed as it is for guards): access
// audience, age limits, opening hours, maintenance and capacity all apply.
export const POST = withRoute(async (request) => {
  const claims = await getClaims(request);
  await connectDB();
  const ctx = await memberContext(claims, request);
  requireCapability(ctx, CAPABILITY.SELF_CHECK_IN);

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return zodError(parsed);

  const verification = await verifyToken({ societyId: ctx.societyId, raw: parsed.data.token });

  // Recorded before any early return: rejected scans are the signal that a
  // sticker has leaked, expired or been replaced.
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
  });

  if (!verification.ok) {
    const message = {
      EXPIRED: "This QR code has expired. Please ask the society office for the current code.",
      REVOKED: "This QR code is no longer valid.",
      INVALID_TOKEN: "That does not look like an amenity QR code.",
      WRONG_SOCIETY: "This QR code belongs to a different society.",
    }[verification.result] || "This QR code could not be validated.";
    throw new ApiError(verification.result === "INVALID_TOKEN" ? 400 : 410, message);
  }

  const amenity = await Amenity.findOne({
    _id: verification.token.amenityId,
    societyId: ctx.societyId,
    isDeleted: false,
  }).lean();
  if (!amenity) throw new ApiError(404, "Amenity not found");

  if (![ATTENDANCE_MODE.QR, ATTENDANCE_MODE.QR_MANUAL].includes(amenity.attendanceMode)) {
    throw new ApiError(409, "QR check-in is not enabled for this amenity.");
  }

  let record;
  try {
    record = await checkIn({
      societyId: ctx.societyId,
      amenity,
      attendeeType: "RESIDENT",
      memberId: ctx.memberId,
      userId: ctx.userId,
      residentName: ctx.member.name,
      flatNo: ctx.flatLabel,
      occupancyType: ctx.occupancyType,
      age: ctx.age,
      eventId: parsed.data.eventId || null,
      guestCount: parsed.data.guestCount || 0,
      method: CHECKIN_METHOD.QR,
      qrTokenId: verification.token._id,
      checkedInBy: ctx.userId,
      checkedInByName: ctx.member.name,
      checkedInByRole: ctx.role,
      actor: ctx.actor,
    });
  } catch (err) {
    // CheckInError is an expected rejection (closed, full, already inside,
    // not eligible…) not a server fault — without this it fell through to
    // withRoute's catch-all and the resident saw a bare "Internal server
    // error" instead of the actual reason.
    if (err instanceof CheckInError) {
      throw new ApiError(STATUS_BY_CODE[err.code] || 409, { error: err.message, code: err.code, ...(err.meta || {}) });
    }
    throw err;
  }

  await logAmenityActivity({
    societyId: ctx.societyId,
    entityType: "ATTENDANCE",
    entityId: record._id,
    amenityId: amenity._id,
    amenityName: amenity.name,
    // FIX: this read ACTIVITY_ACTION.ATTENDANCE_CHECKED_IN, which does not
    // exist in lib/amenities/constants (the constant is ATTENDANCE_CHECK_IN).
    // `action` is a required field, so every write threw — and
    // logAmenityActivity swallows its own failures by design, so resident
    // self-check-ins silently never appeared in the activity log at all.
    action: ACTIVITY_ACTION.ATTENDANCE_CHECK_IN,
    actor: ctx.actor,
    newValue: { name: ctx.member.name, method: CHECKIN_METHOD.QR, self: true },
  });

  return json({
    checkedIn: true,
    attendance: {
      _id: record._id,
      timeIn: record.timeIn,
      slotLabel: record.slotLabel || null,
    },
    amenity: { _id: amenity._id, name: amenity.name },
    message: `Checked in to ${amenity.name}`,
  });
});

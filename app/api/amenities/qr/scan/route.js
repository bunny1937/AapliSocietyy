import Amenity from "@/models/amenities/Amenity";
import AmenityAttendance from "@/models/amenities/AmenityAttendance";
import { qrScanSchema } from "@/lib/amenities/schemas";
import { verifyToken, recordScan } from "@/lib/amenities/qrService";
import { checkIn, checkOut } from "@/lib/amenities/attendanceService";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION, CHECKIN_METHOD, ATTENDANCE_MODE } from "@/lib/amenities/constants";
import { gate, ok, fail, zodFail, withAmenityRoute, CAPABILITY, serviceError } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/amenities/qr/scan — staff-side scanning (guard desk / admin device).
//
// Residents scanning their own phone use the mobile endpoints under /api/v1;
// this one exists because a guard scans *someone else's* pass and therefore
// needs the attendee identified in the request body.
//
// Every attempt is recorded, including rejections: "the code was scanned 40
// times and refused" is the signal that a sticker has leaked or expired.
export const POST = withAmenityRoute(async (request) => {
  const g = await gate(request, CAPABILITY.SCAN_QR);
  if (!g.ok) return g.response;

  const parsed = qrScanSchema.safeParse(await request.json());
  if (!parsed.success) return zodFail(parsed);

  const verification = await verifyToken({ societyId: g.societyId, raw: parsed.data.token });

  await recordScan({
    societyId: g.societyId,
    amenityId: verification.token?.amenityId || null,
    tokenId: verification.token?._id || null,
    tokenPrefix: verification.parsed?.prefix || "",
    result: verification.result,
    scannedBy: g.actor.userId,
    scannedByName: g.actor.name,
    scannedByRole: g.actor.role,
    memberId: parsed.data.memberId || null,
    deviceInfo: g.actor.userAgent,
    ip: g.actor.ip,
    locationHint: parsed.data.locationHint || "",
  });

  if (!verification.ok) {
    // 410 for expired/revoked, 400 for malformed — mapped centrally.
    const err = new Error(
      {
        EXPIRED: "This QR code has expired. Ask an admin to print a new one.",
        REVOKED: "This QR code has been revoked.",
        INVALID_TOKEN: "This is not a valid amenity QR code.",
      }[verification.result] || "This QR code could not be validated.",
    );
    err.code = verification.result;
    return serviceError(err);
  }

  const amenity = await Amenity.findOne({
    _id: verification.token.amenityId,
    societyId: g.societyId,
    isDeleted: false,
  }).lean();
  if (!amenity) return fail(404, "Amenity not found");

  if (![ATTENDANCE_MODE.QR, ATTENDANCE_MODE.QR_MANUAL].includes(amenity.attendanceMode)) {
    return fail(409, "QR attendance is not enabled for this amenity");
  }

  // Toggle semantics: one scan action, the server decides in or out. A guard
  // should not have to pick the right button while a queue waits.
  const open = await AmenityAttendance.findOne({
    societyId: g.societyId,
    amenityId: amenity._id,
    timeOut: null,
    ...(parsed.data.memberId ? { memberId: parsed.data.memberId } : { visitorPhone: parsed.data.visitorPhone || "__none__" }),
  })
    .sort({ timeIn: -1 })
    .lean();

  try {
    if (open && parsed.data.direction !== "IN") {
      const record = await checkOut({
        societyId: g.societyId,
        attendanceId: open._id,
        method: CHECKIN_METHOD.QR,
        checkedOutBy: g.actor.userId,
        checkedOutByName: g.actor.name,
        actor: g.actor,
      });
      await logAmenityActivity({
        societyId: g.societyId,
        entityType: "ATTENDANCE",
        entityId: record._id,
        amenityId: amenity._id,
        amenityName: amenity.name,
        action: ACTIVITY_ACTION.ATTENDANCE_CHECKED_OUT,
        actor: g.actor,
        newValue: { durationMins: record.durationMins, method: CHECKIN_METHOD.QR },
      });
      return ok({ direction: "OUT", attendance: record, amenity: { _id: amenity._id, name: amenity.name } });
    }

    const record = await checkIn({
      societyId: g.societyId,
      amenity,
      attendeeType: parsed.data.attendeeType || "RESIDENT",
      memberId: parsed.data.memberId || null,
      residentName: parsed.data.residentName || "",
      flatNo: parsed.data.flatNo || "",
      occupancyType: parsed.data.occupancyType || null,
      visitorName: parsed.data.visitorName || "",
      visitorPhone: parsed.data.visitorPhone || "",
      eventId: parsed.data.eventId || null,
      method: CHECKIN_METHOD.QR,
      qrTokenId: verification.token._id,
      checkedInBy: g.actor.userId,
      checkedInByName: g.actor.name,
      checkedInByRole: g.actor.role,
      skipEligibility: true,
      actor: g.actor,
    });

    await logAmenityActivity({
      societyId: g.societyId,
      entityType: "ATTENDANCE",
      entityId: record._id,
      amenityId: amenity._id,
      amenityName: amenity.name,
      action: ACTIVITY_ACTION.ATTENDANCE_CHECKED_IN,
      actor: g.actor,
      newValue: { name: record.residentName || record.visitorName, method: CHECKIN_METHOD.QR },
    });

    return ok({ direction: "IN", attendance: record, amenity: { _id: amenity._id, name: amenity.name } });
  } catch (err) {
    return serviceError(err);
  }
});

import Amenity from "@/models/amenities/Amenity";
import AmenityAttendance from "@/models/amenities/AmenityAttendance";
import { checkInSchema } from "@/lib/amenities/schemas";
import { checkIn } from "@/lib/amenities/attendanceService";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION, ATTENDANCE_MODE, CHECKIN_METHOD } from "@/lib/amenities/constants";
import { can, CAPABILITY as CAP } from "@/lib/amenities/permissions";
import {
  gate, ok, created, fail, zodFail, isId, paging, pageMeta, dateRange,
  withAmenityRoute, CAPABILITY, serviceError,
} from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/amenities/attendance?amenityId=&from=&to=&openOnly=1&attendeeType=&q=
// The admin/guard attendance register.
export const GET = withAmenityRoute(async (request) => {
  const g = await gate(request, CAPABILITY.VIEW_ALL_ATTENDANCE);
  if (!g.ok) return g.response;

  const sp = new URL(request.url).searchParams;
  const { page, limit, skip } = paging(sp, { defaultLimit: 50 });
  const range = dateRange(sp, { defaultDays: 7 });
  if (!range) return fail(422, "Invalid date range");

  const filter = { societyId: g.societyId };
  if (isId(sp.get("amenityId"))) filter.amenityId = sp.get("amenityId");
  if (isId(sp.get("eventId"))) filter.eventId = sp.get("eventId");
  if (sp.get("attendeeType")) filter.attendeeType = sp.get("attendeeType");
  if (sp.get("method")) filter.checkInMethod = sp.get("method");

  // "Who is inside right now" ignores the date window on purpose — a session
  // opened before midnight is still open.
  if (sp.get("openOnly") === "1") {
    filter.timeOut = null;
  } else {
    filter.timeIn = { $gte: range.from, $lte: range.to };
  }

  const q = sp.get("q")?.trim();
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ residentName: rx }, { flatNo: rx }, { visitorName: rx }, { visitorPhone: rx }];
  }

  const [records, total, summary] = await Promise.all([
    AmenityAttendance.find(filter).sort({ timeIn: -1 }).skip(skip).limit(limit).lean(),
    AmenityAttendance.countDocuments(filter),
    AmenityAttendance.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$attendeeType",
          count: { $sum: 1 },
          avgDuration: { $avg: "$durationMins" },
          stillInside: { $sum: { $cond: [{ $eq: ["$timeOut", null] }, 1, 0] } },
        },
      },
    ]),
  ]);

  return ok({
    attendance: records,
    summary,
    pagination: pageMeta({ page, limit, total }),
    range,
  });
});

// POST /api/amenities/attendance — manual check-in by admin or security.
//
// Allowed on QR-only amenities *only* for roles holding the override capability,
// which is exactly what the "QR + Manual Override" mode means; the override is
// flagged on the row so audits can tell it from a scan.
export const POST = withAmenityRoute(async (request) => {
  const g = await gate(request, CAPABILITY.RECORD_ATTENDANCE);
  if (!g.ok) return g.response;

  const parsed = checkInSchema.safeParse(await request.json());
  if (!parsed.success) return zodFail(parsed);

  const amenity = await Amenity.findOne({
    _id: parsed.data.amenityId,
    societyId: g.societyId,
    isDeleted: false,
  }).lean();
  if (!amenity) return fail(404, "Amenity not found");

  if (amenity.attendanceMode === ATTENDANCE_MODE.NONE) {
    return fail(409, "Attendance tracking is turned off for this amenity");
  }

  const isOverride = amenity.attendanceMode === ATTENDANCE_MODE.QR;
  if (isOverride && !can(g.user.role, CAP.OVERRIDE_ATTENDANCE)) {
    return fail(403, "This amenity is QR-only. You do not have permission to override with a manual entry.");
  }

  try {
    const record = await checkIn({
      societyId: g.societyId,
      amenity,
      attendeeType: parsed.data.attendeeType,
      memberId: parsed.data.memberId || null,
      userId: parsed.data.userId || null,
      residentName: parsed.data.residentName || "",
      flatNo: parsed.data.flatNo || "",
      occupancyType: parsed.data.occupancyType || null,
      visitorName: parsed.data.visitorName || "",
      visitorPhone: parsed.data.visitorPhone || "",
      visitorId: parsed.data.visitorId || null,
      eventId: parsed.data.eventId || null,
      guestCount: parsed.data.guestCount || 0,
      method: isOverride ? CHECKIN_METHOD.OVERRIDE : CHECKIN_METHOD.MANUAL,
      isOverride,
      overrideReason: parsed.data.overrideReason || "",
      checkedInBy: g.actor.userId,
      checkedInByName: g.actor.name,
      checkedInByRole: g.actor.role,
      // Staff recording attendance on someone's behalf bypasses the age/audience
      // gate deliberately: the guard is standing in front of the person and can
      // see the situation. The bypass is recorded on the row.
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
      newValue: {
        attendeeType: record.attendeeType,
        name: record.residentName || record.visitorName,
        method: record.checkInMethod,
      },
      note: isOverride ? `Manual override: ${parsed.data.overrideReason || "not stated"}` : "",
    });

    return created({ attendance: record });
  } catch (err) {
    return serviceError(err);
  }
});

import { withRoute, json } from "@/lib/v1/http";
import connectDB from "@/lib/mongodb";
import AmenityAttendance from "@/models/amenities/AmenityAttendance";
import Amenity from "@/models/amenities/Amenity";
import { clubhouseContext } from "@/lib/amenities/clubhouseContext";
import { CAPABILITY } from "@/lib/amenities/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;

// GET /api/v1/clubhouse/attendance?amenityId=&q=&cursor=
//
// Currently inside — the manager's live floor list, and the list they check
// people out from.
//
// timeOut: null IS the open-session definition used everywhere else in the
// module (it is what the partial unique index on attendance is built around),
// so this needs no "active" flag of its own and cannot drift out of step with
// occupancy.
//
// Cursor paginated on timeIn, not skip/limit: at a busy clubhouse rows are being
// inserted while the manager scrolls, and an offset would show duplicates.
export const GET = withRoute(async (request) => {
  const ctx = await clubhouseContext(request, CAPABILITY.VIEW_ALL_ATTENDANCE);
  await connectDB();

  const sp = new URL(request.url).searchParams;
  const amenityId = sp.get("amenityId");
  const q = sp.get("q")?.trim();
  const cursor = sp.get("cursor");

  const filter = { societyId: ctx.societyId, timeOut: null };
  if (amenityId && /^[a-f\d]{24}$/i.test(amenityId)) filter.amenityId = amenityId;
  if (cursor) filter.timeIn = { $lt: new Date(cursor) };
  if (q) {
    // Search is over the denormalised name/flat already on the attendance row,
    // so finding "1204" never fans out into a member lookup per row.
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ residentName: rx }, { flatNo: rx }];
  }

  const rows = await AmenityAttendance.find(filter)
    .sort({ timeIn: -1 })
    .limit(PAGE_SIZE + 1)
    .select("amenityId amenityName residentName flatNo slotLabel timeIn attendeeType guestCount checkedInByName checkInMethod memberId")
    .lean();

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const now = Date.now();

  // Per-amenity counts for the filter chips, from the same source of truth as
  // the list itself rather than from Amenity.liveOccupancy — two numbers that
  // could disagree on one screen is worse than one number.
  const byAmenity = await AmenityAttendance.aggregate([
    { $match: { societyId: ctx.societyId, timeOut: null } },
    { $group: { _id: "$amenityId", name: { $first: "$amenityName" }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  return json({
    insideCount: byAmenity.reduce((sum, a) => sum + a.count, 0),
    byAmenity: byAmenity.map((a) => ({ amenityId: a._id, name: a.name, count: a.count })),
    attendance: page.map((r) => ({
      _id: r._id,
      amenityId: r.amenityId,
      amenityName: r.amenityName,
      memberId: r.memberId,
      memberName: r.residentName,
      flatLabel: r.flatNo,
      slotLabel: r.slotLabel || "",
      timeIn: r.timeIn,
      // Computed here so every device shows the same elapsed time regardless of
      // its own clock.
      minutesInside: Math.max(0, Math.round((now - new Date(r.timeIn).getTime()) / 60000)),
      attendeeType: r.attendeeType,
      guestCount: r.guestCount || 0,
      checkedInByName: r.checkedInByName || "",
      checkInMethod: r.checkInMethod,
    })),
    nextCursor: hasMore ? page[page.length - 1].timeIn : null,
  });
});

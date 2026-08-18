import { withRoute, json } from "@/lib/v1/http";
import connectDB from "@/lib/mongodb";
import AmenityAttendance from "@/models/amenities/AmenityAttendance";
import AmenityActivityLog from "@/models/amenities/AmenityActivityLog";
import { clubhouseContext } from "@/lib/amenities/clubhouseContext";
import { CAPABILITY } from "@/lib/amenities/permissions";
import { getTimezone } from "@/lib/amenities/settingsService";
import { dayKey, startOfDayUtc, endOfDayUtc } from "@/lib/amenities/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;
const SORTS = {
  recent: { timeIn: -1 },
  oldest: { timeIn: 1 },
  longest: { durationMins: -1 },
};

// GET /api/v1/clubhouse/history?from=&to=&amenityId=&q=&sort=&cursor=&mine=1
//
// Closed sessions, and the manager's own action trail. The counterpart to the
// Attendance tab's "currently inside": this is "what happened".
//
// Filtering is on dayKey, the module's existing local-day grain, so a date range
// picked in the app means the same days the analytics rollups and the website
// report mean.
//
// Page-based rather than cursor-based here, deliberately: history is a settled
// dataset being sorted three different ways, and "page 4 of 12" is what a person
// scanning a month of visits actually wants. Live attendance is the opposite
// case and uses a cursor.
export const GET = withRoute(async (request) => {
  const ctx = await clubhouseContext(request, CAPABILITY.VIEW_ALL_ATTENDANCE);
  await connectDB();

  const sp = new URL(request.url).searchParams;
  const timezone = await getTimezone(ctx.societyId);
  const today = dayKey(new Date(), timezone);

  const from = sp.get("from") || today;
  const to = sp.get("to") || from;
  const amenityId = sp.get("amenityId");
  const q = sp.get("q")?.trim();
  const sort = SORTS[sp.get("sort")] || SORTS.recent;
  const page = Math.max(1, Number(sp.get("page")) || 1);

  // Manager's own trail: when + what + who, straight out of the existing amenity
  // activity log. No second audit store.
  if (sp.get("mine") === "1") {
    const actions = await AmenityActivityLog.find({
      societyId: ctx.societyId,
      userId: ctx.userId,
      at: { $gte: startOfDayUtc(from, timezone), $lt: endOfDayUtc(to, timezone) },
    })
      .sort({ at: -1 })
      .limit(100)
      .select("action entityType amenityName note at newValue")
      .lean();

    return json({
      mode: "actions",
      range: { from, to },
      actions: actions.map((a) => ({
        _id: a._id,
        action: a.action,
        entityType: a.entityType,
        amenityName: a.amenityName || "",
        note: a.note || "",
        at: a.at,
      })),
    });
  }

  const filter = {
    societyId: ctx.societyId,
    dayKey: { $gte: from, $lte: to },
    timeOut: { $ne: null },
  };
  if (amenityId && /^[a-f\d]{24}$/i.test(amenityId)) filter.amenityId = amenityId;
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ residentName: rx }, { flatNo: rx }, { amenityName: rx }];
  }

  const [rows, total, totals] = await Promise.all([
    AmenityAttendance.find(filter)
      .sort(sort)
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .select("amenityName residentName flatNo slotLabel timeIn timeOut durationMins autoCheckedOut checkedInByName checkedOutByName attendeeType")
      .lean(),
    AmenityAttendance.countDocuments(filter),
    AmenityAttendance.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          visits: { $sum: 1 },
          avgMins: { $avg: "$durationMins" },
        },
      },
    ]),
  ]);

  return json({
    mode: "attendance",
    range: { from, to },
    page,
    pageSize: PAGE_SIZE,
    total,
    hasMore: page * PAGE_SIZE < total,
    // Two honest aggregates, not a dashboard: total visits and average stay.
    // Charts, exports and forecasting stay on the Admin website.
    summary: {
      visits: totals[0]?.visits || 0,
      avgDurationMins: totals[0]?.avgMins ? Math.round(totals[0].avgMins) : 0,
    },
    attendance: rows.map((r) => ({
      _id: r._id,
      amenityName: r.amenityName,
      memberName: r.residentName,
      flatLabel: r.flatNo,
      slotLabel: r.slotLabel || "",
      timeIn: r.timeIn,
      timeOut: r.timeOut,
      durationMins: r.durationMins || 0,
      // Surfaced rather than hidden: a session the stale-session sweeper closed
      // is not the same evidence as one a person checked out of.
      autoCheckedOut: !!r.autoCheckedOut,
      checkedInByName: r.checkedInByName || "",
      checkedOutByName: r.checkedOutByName || "",
      attendeeType: r.attendeeType,
    })),
  });
});

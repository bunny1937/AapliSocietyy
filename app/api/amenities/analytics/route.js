import Amenity from "@/models/amenities/Amenity";
import AmenityIncident from "@/models/amenities/AmenityIncident";
import AmenityEvent from "@/models/amenities/AmenityEvent";
import AmenityQrScan from "@/models/amenities/AmenityQrScan";
import { getAnalytics } from "@/lib/amenities/analyticsService";
import { getTimezone } from "@/lib/amenities/settingsService";
import { capacitySnapshot } from "@/lib/amenities/attendanceService";
import { INCIDENT_STATUS, AMENITY_STATUS } from "@/lib/amenities/constants";
import {
  gate, ok, fail, isId, dateRange, withAmenityRoute, CAPABILITY,
} from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/amenities/analytics?from=&to=&amenityId=&granularity=daily|weekly|monthly|yearly
//
// Reads the pre-aggregated amenity_analytics_daily rollup rather than scanning
// raw attendance. That is what keeps a township with millions of check-ins
// answering in the same time as a 40-flat society: the heavy work happened at
// write time.
export const GET = withAmenityRoute(async (request) => {
  const g = await gate(request, CAPABILITY.VIEW_ANALYTICS);
  if (!g.ok) return g.response;

  const sp = new URL(request.url).searchParams;
  const range = dateRange(sp, { defaultDays: 30 });
  if (!range) return fail(422, "Invalid date range — check that 'from' is before 'to'");

  const granularity = sp.get("granularity") || "daily";
  if (!["daily", "weekly", "monthly", "yearly"].includes(granularity)) {
    return fail(422, "granularity must be daily, weekly, monthly or yearly");
  }

  const amenityId = isId(sp.get("amenityId")) ? sp.get("amenityId") : null;
  const timezone = await getTimezone(g.societyId);

  const analytics = await getAnalytics({
    societyId: g.societyId,
    from: range.from,
    to: range.to,
    amenityId,
    granularity,
    timezone,
  });

  // Headline numbers that are not derivable from the daily rollup.
  const [amenities, openIncidents, eventStats, qrStats] = await Promise.all([
    Amenity.find({ societyId: g.societyId, isDeleted: false })
      .select("name status isActive capacity liveOccupancy")
      .lean(),
    AmenityIncident.countDocuments({
      societyId: g.societyId,
      status: { $in: [INCIDENT_STATUS.OPEN, INCIDENT_STATUS.IN_PROGRESS] },
    }),
    AmenityEvent.aggregate([
      {
        $match: {
          societyId: g.societyId,
          startAt: { $gte: range.from, $lte: range.to },
          ...(amenityId ? { amenityId: (await import("mongoose")).default.Types.ObjectId.createFromHexString(amenityId) } : {}),
        },
      },
      {
        $group: {
          _id: null,
          events: { $sum: 1 },
          registrations: { $sum: "$registeredCount" },
          attended: { $sum: "$attendedCount" },
          waitlisted: { $sum: "$waitlistCount" },
        },
      },
    ]),
    AmenityQrScan.aggregate([
      {
        $match: {
          societyId: g.societyId,
          scannedAt: { $gte: range.from, $lte: range.to },
        },
      },
      { $group: { _id: "$result", count: { $sum: 1 } } },
    ]),
  ]);

  const liveCapacity = amenities.map((a) => ({
    amenityId: a._id,
    name: a.name,
    ...capacitySnapshot(a),
  }));

  return ok({
    ...analytics,
    granularity,
    kpis: {
      ...analytics.totals,
      totalAmenities: amenities.length,
      activeAmenities: amenities.filter((a) => a.isActive).length,
      underMaintenance: amenities.filter((a) => a.status === AMENITY_STATUS.UNDER_MAINTENANCE).length,
      openIncidents,
      events: eventStats[0]?.events || 0,
      eventRegistrations: eventStats[0]?.registrations || 0,
      eventAttendance: eventStats[0]?.attended || 0,
      eventWaitlisted: eventStats[0]?.waitlisted || 0,
      // "QR usage" is only meaningful next to its rejection rate.
      qrScans: qrStats.reduce((sum, r) => sum + r.count, 0),
      qrScansValid: qrStats.find((r) => r._id === "VALID")?.count || 0,
    },
    qrBreakdown: qrStats,
    liveCapacity,
  });
});

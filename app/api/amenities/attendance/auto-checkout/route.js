import Amenity from "@/models/amenities/Amenity";
import { autoCheckoutStale } from "@/lib/amenities/attendanceService";
import { getSettings } from "@/lib/amenities/settingsService";
import { gate, ok, withAmenityRoute, CAPABILITY } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/amenities/attendance/auto-checkout
//
// Housekeeping for sessions nobody closed (people forget to scan out). Without
// this, live occupancy drifts upward forever and a capacity-limited amenity
// eventually refuses everyone.
//
// Safe to run repeatedly — it only touches rows older than the configured
// window, and stamps them as auto-closed so they are distinguishable from real
// check-outs in analytics.
export const POST = withAmenityRoute(async (request) => {
  const g = await gate(request, CAPABILITY.ADJUST_ATTENDANCE);
  if (!g.ok) return g.response;

  const settings = await getSettings(g.societyId);
  const body = await request.json().catch(() => ({}));
  const afterMins = Number(body.afterMins) || settings?.autoCheckoutAfterMins || 240;

  const amenities = await Amenity.find({ societyId: g.societyId, isDeleted: false })
    .select("_id name")
    .lean();

  const results = [];
  for (const amenity of amenities) {
    const res = await autoCheckoutStale({
      societyId: g.societyId,
      amenityId: amenity._id,
      afterMins,
      timezone: settings?.timezone,
    });
    if (res?.closed) results.push({ amenityId: amenity._id, name: amenity.name, closed: res.closed });
  }

  return ok({
    afterMins,
    amenitiesTouched: results.length,
    totalClosed: results.reduce((sum, r) => sum + r.closed, 0),
    results,
  });
});

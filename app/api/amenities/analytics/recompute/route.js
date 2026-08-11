import Amenity from "@/models/amenities/Amenity";
import { recomputeDay } from "@/lib/amenities/analyticsService";
import { getTimezone } from "@/lib/amenities/settingsService";
import { dayKeyRange } from "@/lib/amenities/time";
import { gate, ok, fail, isId, dateRange, withAmenityRoute, CAPABILITY } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/amenities/analytics/recompute
//
// Rebuilds daily rollups from raw attendance. The rollup is normally maintained
// incrementally on check-in/check-out, but incremental counters can drift after
// manual adjustments or a partial failure, so there has to be a way to restate
// the truth from the source rows. Capped at 90 days per call to stay well inside
// a request timeout.
export const POST = withAmenityRoute(async (request) => {
  const g = await gate(request, CAPABILITY.VIEW_ANALYTICS);
  if (!g.ok) return g.response;

  const sp = new URL(request.url).searchParams;
  const body = await request.json().catch(() => ({}));
  const range = dateRange(
    new URLSearchParams({ from: body.from || sp.get("from") || "", to: body.to || sp.get("to") || "" }),
    { defaultDays: 7 },
  );
  if (!range) return fail(422, "Invalid date range");

  const timezone = await getTimezone(g.societyId);
  const days = dayKeyRange(range.from, range.to, timezone);
  if (days.length > 90) return fail(422, "Recompute at most 90 days at a time");

  const amenityId = body.amenityId || sp.get("amenityId");
  const amenities = isId(amenityId)
    ? [{ _id: amenityId }]
    : await Amenity.find({ societyId: g.societyId, isDeleted: false }).select("_id").lean();

  let recomputed = 0;
  for (const amenity of amenities) {
    for (const dayKeyStr of days) {
      await recomputeDay({ societyId: g.societyId, amenityId: amenity._id, dayKeyStr, timezone });
      recomputed += 1;
    }
  }

  return ok({ recomputed, days: days.length, amenities: amenities.length });
});

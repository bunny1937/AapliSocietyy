import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import Amenity from "@/models/amenities/Amenity";
import { recomputeDay } from "@/lib/amenities/analyticsService";
import { getTimezone } from "@/lib/amenities/settingsService";
import { dayKeyRange } from "@/lib/amenities/time";
import { cronAuthorized } from "@/lib/v1/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /v1/cron/amenities-analytics-recompute
//
// Nightly cross-society rebuild of the previous day's rollups, so incremental
// counters that drifted from manual adjustments or a partial failure get
// restated from the source attendance ledger. Call once a day, off-peak:
//
//   URL:    https://aaplisociety.visync.in/v1/cron/amenities-analytics-recompute
//   Method: GET
//   Header: Authorization: Bearer <CRON_SECRET>
//   When:   nightly, ~03:00 IST
export async function GET(request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await connectDB();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const societies = await Society.find({}).select("_id").lean();

  let recomputed = 0;
  for (const society of societies) {
    const timezone = await getTimezone(society._id);
    const days = dayKeyRange(yesterday, yesterday, timezone);
    const amenities = await Amenity.find({ societyId: society._id, isDeleted: false })
      .select("_id")
      .lean();

    for (const amenity of amenities) {
      for (const dayKeyStr of days) {
        await recomputeDay({ societyId: society._id, amenityId: amenity._id, dayKeyStr, timezone });
        recomputed += 1;
      }
    }
  }

  return NextResponse.json({ ok: true, societiesChecked: societies.length, recomputed });
}

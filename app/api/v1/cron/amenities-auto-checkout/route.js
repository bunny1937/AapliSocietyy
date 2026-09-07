import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import Amenity from "@/models/amenities/Amenity";
import { autoCheckoutStale } from "@/lib/amenities/attendanceService";
import { getSettings } from "@/lib/amenities/settingsService";
import { cronAuthorized } from "@/lib/v1/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /v1/cron/amenities-auto-checkout
//
// Cross-society sweep for sessions nobody closed. Without this, live occupancy
// drifts upward forever and capacity-limited amenities eventually refuse
// everyone (see AMENITIES-WEB-NOTES.md §6 — flagged as the most damaging job
// to skip). Call every 15 minutes from an external scheduler (cron-jobs.org),
// same as /v1/cron/cleanup, since Vercel Hobby cron cannot run finer than daily:
//
//   URL:    https://aaplisociety.visync.in/v1/cron/amenities-auto-checkout
//   Method: GET
//   Header: Authorization: Bearer <CRON_SECRET>
//   When:   every 15 minutes
export async function GET(request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await connectDB();
  const societies = await Society.find({}).select("_id").lean();

  let amenitiesTouched = 0;
  let totalClosed = 0;
  for (const society of societies) {
    const settings = await getSettings(society._id);
    const afterMins = settings?.autoCheckoutAfterMins || 240;
    const amenities = await Amenity.find({ societyId: society._id, isDeleted: false })
      .select("_id")
      .lean();

    for (const amenity of amenities) {
      const res = await autoCheckoutStale({
        societyId: society._id,
        amenityId: amenity._id,
        afterMins,
        timezone: settings?.timezone,
      });
      if (res?.closed) {
        amenitiesTouched += 1;
        totalClosed += res.closed;
      }
    }
  }

  return NextResponse.json({ ok: true, societiesChecked: societies.length, amenitiesTouched, totalClosed });
}

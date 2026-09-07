import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import { sendDueReminders } from "@/lib/amenities/eventService";
import { getSettings } from "@/lib/amenities/settingsService";
import { cronAuthorized } from "@/lib/v1/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /v1/cron/amenities-event-reminders
//
// Cross-society sweep that sends due event reminders. Idempotent — each event
// records reminderSentAt before sending, so overlapping runs cannot double
// notify. Call every 15 minutes from an external scheduler:
//
//   URL:    https://aaplisociety.visync.in/v1/cron/amenities-event-reminders
//   Method: GET
//   Header: Authorization: Bearer <CRON_SECRET>
//   When:   every 15 minutes
export async function GET(request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await connectDB();
  const societies = await Society.find({}).select("_id").lean();

  let remindersSent = 0;
  for (const society of societies) {
    const settings = await getSettings(society._id);
    const result = await sendDueReminders({
      societyId: society._id,
      leadMins: settings?.eventReminderLeadMins || 120,
      now: new Date(),
      limit: 50,
    });
    remindersSent += result?.sent || result?.count || 0;
  }

  return NextResponse.json({ ok: true, societiesChecked: societies.length, remindersSent });
}

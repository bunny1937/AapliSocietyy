import { sendDueReminders } from "@/lib/amenities/eventService";
import { getSettings } from "@/lib/amenities/settingsService";
import { gate, ok, withAmenityRoute, CAPABILITY } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/amenities/events/reminders
//
// Event reminders are pull-based: something must call this on a schedule (a
// platform cron, or the existing job runner). Written to be idempotent — each
// event records reminderSentAt, so calling this every five minutes sends each
// reminder exactly once.
export const POST = withAmenityRoute(async (request) => {
  const g = await gate(request, CAPABILITY.MANAGE_EVENTS);
  if (!g.ok) return g.response;

  const settings = await getSettings(g.societyId);
  const body = await request.json().catch(() => ({}));

  const result = await sendDueReminders({
    societyId: g.societyId,
    leadMins: Number(body.leadMins) || settings?.eventReminderLeadMins || 120,
    now: new Date(),
    limit: Number(body.limit) || 50,
  });

  return ok(result);
});

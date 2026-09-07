import { withRoute, json } from "@/lib/v1/http";
import { cronAuthorized } from "@/lib/v1/config";
import connectDB from "@/lib/mongodb";
import { setting } from "@/lib/platform/settings";
import { ensureSettings } from "@/lib/platform/settingsStore";
import Society from "@/models/Society";
import SocietyHandover from "@/models/SocietyHandover";
import { sendHandoverEmails } from "@/lib/superadmin/societyHandover";
import { logSocietyLifecycle, SOCIETY_LIFECYCLE_ACTIONS } from "@/lib/superadmin/societyAudit";
import { withCronRun } from "@/lib/ops/cronTracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Re-send at most this often, and stop after this many attempts. A society
// that has ignored six reminders is not going to be moved by a seventh, and
// past that point the mail is just noise arriving in an inbox nobody reads.
const REMIND_EVERY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_REMINDERS = () => setting("SOCIETY_HANDOVER_MAX_REMINDERS");
const MAX_PER_RUN = 25;

/**
 * GET /v1/cron/society-handover-reminder
 *
 * cron-job.org, weekly (Mondays, 05:00 IST):
 *   https://aaplisociety.visync.in/v1/cron/society-handover-reminder
 *   Header: Authorization: Bearer <CRON_SECRET>
 *
 * ## Why this is not optional
 *
 * society-purge refuses to erase a society whose handover was never collected.
 * That is the right failure mode, but on its own it produces a quiet deadlock:
 * the society never opens the mail, the purge never runs, and we keep holding
 * personal data we have no further reason to hold — the exact outcome the
 * offboarding flow exists to prevent. The gate creates the obligation to
 * chase.
 *
 * So this is the chasing half. It reminds only where a reminder can still
 * change the outcome: a handover that was notified, never downloaded, and
 * whose society still exists.
 *
 * The reminder is the same mail as the original — no data, no link to data,
 * just a link to their own dashboard.
 *
 * `?dryRun=1` reports without sending.
 */
export const GET = withRoute(async (req) => {
  if (!cronAuthorized(req)) return json({ error: "Unauthorized" }, { status: 401 });
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  return json(await withCronRun("society-handover-reminder", (ctx) => runHandoverReminder(ctx.req))({ dryRun, req }));
});

async function runHandoverReminder(req) {
  await ensureSettings();

  await connectDB();
  const startedAt = Date.now();
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const now = Date.now();

  const pending = await SocietyHandover.find({
    status: "notified",
    downloadedAt: null,
    notifiedAt: { $ne: null },
  })
    .sort({ notifiedAt: 1 })
    .limit(MAX_PER_RUN)
    .select("societyId societyName recipients counts artifacts notifiedAt lastRemindedAt reminderCount")
    .lean();

  const results = [];

  for (const h of pending) {
    const base = { handoverId: String(h._id), societyName: h.societyName };
    const since = new Date(h.lastRemindedAt || h.notifiedAt).getTime();

    if (now - since < REMIND_EVERY_MS) {
      results.push({ ...base, action: "skipped", reason: "reminded recently" });
      continue;
    }
    if ((h.reminderCount || 0) >= MAX_REMINDERS()) {
      results.push({ ...base, action: "skipped", reason: "reminder limit reached" });
      continue;
    }
    if (!h.recipients?.length) {
      results.push({ ...base, action: "skipped", reason: "no registered email on file" });
      continue;
    }

    // The society may have been purged, restored, or had its erasure date
    // moved since the handover was built — the mail must say what is true now.
    const society = await Society.findById(h.societyId)
      .select("name isDeleted purgeScheduledFor")
      .lean();
    if (!society) {
      results.push({ ...base, action: "skipped", reason: "society no longer exists" });
      continue;
    }

    if (dryRun) {
      results.push({ ...base, action: "would-remind", recipients: h.recipients });
      continue;
    }

    const sent = await sendHandoverEmails({
      recipients: h.recipients,
      societyName: society.name || h.societyName,
      counts: h.counts,
      artifacts: h.artifacts || [],
      purgeScheduledFor: society.isDeleted ? society.purgeScheduledFor : null,
    });

    await SocietyHandover.updateOne(
      { _id: h._id },
      {
        $set: {
          lastRemindedAt: new Date(),
          ...(sent.sent ? {} : { notifyError: sent.failed.map((f) => f.error).join("; ") }),
        },
        $inc: { reminderCount: 1 },
      },
    );

    await logSocietyLifecycle({
      action: SOCIETY_LIFECYCLE_ACTIONS.HANDOVER_REMINDED,
      societyId: h.societyId,
      societyName: society.name || h.societyName,
      actorUserId: null, // "Cron"
      details: {
        handoverId: String(h._id),
        attempt: (h.reminderCount || 0) + 1,
        recipients: h.recipients,
        emailsSent: sent.sent,
      },
    });

    results.push({ ...base, action: "reminded", emailsSent: sent.sent, failed: sent.failed });
  }

  return {
    ok: true,
    dryRun,
    checked: pending.length,
    reminded: results.filter((r) => r.action === "reminded").length,
    skipped: results.filter((r) => r.action === "skipped").length,
    results,
    tookMs: Date.now() - startedAt,
  };
}

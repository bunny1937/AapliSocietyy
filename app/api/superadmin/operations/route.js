import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { validateAdminRequest } from "@/lib/admin-middleware";
import CronRun from "@/models/CronRun";
import { collectHealth } from "@/lib/ops/cronTracker";
import { overallHealth, sortByAttention } from "@/lib/ops/cronHealth";
import { cronSetupLine, CRON_JOBS } from "@/lib/ops/cronRegistry";
import { purgeQueue, handoverQueue, subscriptionQueue, denialQueue } from "@/lib/ops/queues";
import { setting } from "@/lib/platform/settings";
import { ensureSettings } from "@/lib/platform/settingsStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000";

/**
 * GET /api/superadmin/operations
 *
 * Everything scheduled and everything queued, on one page.
 *
 * ## The failure this answers
 *
 * Three separate pieces of the offboarding and entitlements work fail by going
 * quiet. A cron that was never registered raises nothing. A purge that skips
 * every candidate because a gate is unsatisfied logs a successful run. A
 * society knocking on a module it has not bought gets a 404 and we hear about
 * it only if an hourly job happens to be alive.
 *
 * None of that surfaces anywhere a person looks. This is the page a person
 * looks at.
 *
 * `?section=crons` narrows the response — the queues each cost a handful of
 * queries and the header does not need them.
 */
export async function GET(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;

  try {
    await connectDB();
    await ensureSettings();
    const url = new URL(request.url);
    const section = url.searchParams.get("section");
    const now = new Date();

    const health = sortByAttention(await collectHealth(now));

    const payload = {
      generatedAt: now,
      crons: {
        overall: overallHealth(health),
        jobs: health,
        // A job that has never run is almost always one that was never
        // registered, so the fix is a line to paste — not a stack trace.
        setup: CRON_JOBS.map((job) => ({ key: job.key, line: cronSetupLine(job, APP_URL) })),
      },
      config: configHealth(),
    };

    if (section === "crons") return NextResponse.json(payload);

    const [purge, handovers, subscriptions, denials, recentRuns] = await Promise.all([
      purgeQueue(now),
      handoverQueue(now),
      subscriptionQueue(),
      denialQueue(7),
      CronRun.find({}).sort({ startedAt: -1 }).limit(40).select("-__v").lean(),
    ]);

    return NextResponse.json({
      ...payload,
      queues: {
        purge: {
          rows: purge,
          blocked: purge.filter((r) => r.state === "blocked").length,
          ready: purge.filter((r) => r.state === "ready").length,
          waiting: purge.filter((r) => r.state === "waiting").length,
        },
        handovers: {
          rows: handovers,
          unreachable: handovers.filter((h) => h.unreachable).length,
          chased: handovers.filter((h) => (h.reminderCount || 0) >= 6).length,
        },
        subscriptions: { rows: subscriptions },
        denials: { rows: denials },
      },
      recentRuns: recentRuns.map((r) => ({
        ...r,
        _id: String(r._id),
        error: r.error ? String(r.error).slice(0, 400) : null,
      })),
    });
  } catch (err) {
    console.error("operations dashboard error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Configuration that fails by doing nothing.
 *
 * Every one of these is a setting whose absence produces silence rather than an
 * error, which is exactly the class of problem this page exists for. An unset
 * alert address does not throw — it just means no alert is ever delivered,
 * including the alert telling you the alerts are not being delivered.
 */
function configHealth() {
  const alertTo = (setting("ENTITLEMENT_ALERT_EMAIL") || process.env.SUPER_ADMIN_EMAIL || "").trim();
  const breakGlass = setting("SOCIETY_BREAK_GLASS_ADMINS");

  return [
    {
      key: "ENTITLEMENT_ALERT_EMAIL",
      value: alertTo ? mask(alertTo) : null,
      ok: Boolean(alertTo && alertTo.includes("@")),
      severity: "critical",
      why: "Where cron failures, the watchdog, denial alerts and the blocked-society digest go. Unset, all of them are skipped silently — including the one that would tell you a cron has stopped.",
    },
    {
      key: "CRON_SECRET",
      value: process.env.CRON_SECRET ? "set" : null,
      ok: Boolean(process.env.CRON_SECRET),
      severity: "critical",
      why: "Without it, cron endpoints are open in production. With it set here but not on cron-job.org, every scheduled run 401s — which looks exactly like a job that was never registered.",
    },
    {
      key: "SOCIETY_PURGE_ENABLED",
      value: setting("SOCIETY_PURGE_ENABLED") === false ? "false — purging is OFF" : "enabled",
      ok: setting("SOCIETY_PURGE_ENABLED") !== false,
      severity: "warning",
      why: "The platform kill switch. Set to false, society-purge runs nightly, reports success, and erases nothing.",
    },
    {
      key: "SOCIETY_BREAK_GLASS_ADMINS",
      value: breakGlass.length ? `${breakGlass.length} admin(s)` : null,
      // Empty is the CORRECT default here, so this is informational only.
      ok: true,
      severity: "info",
      why: "Who may export a society to their own machine, delete immediately, or waive the collection gate. Empty means nobody, which is the right default until the day it is needed.",
    },
    {
      key: "BREVO_API_KEY",
      value: process.env.BREVO_API_KEY ? "set" : null,
      ok: Boolean(process.env.BREVO_API_KEY),
      severity: "critical",
      why: "Every notification in the offboarding and subscription flows goes through Brevo. Unset, handover emails, reminders and lapse notices all fail — and a society that is never told is a purge gate that never clears.",
    },
  ];
}

function mask(email) {
  const [user, domain] = String(email).split("@");
  if (!domain) return "set";
  return `${user.slice(0, 2)}${"•".repeat(Math.max(1, user.length - 2))}@${domain}`;
}

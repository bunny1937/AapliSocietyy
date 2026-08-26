import connectDB from "@/lib/mongodb";
import CronRun from "@/models/CronRun";
import cache from "@/lib/cache";
import { sendEmail } from "@/lib/brevo-email";
import { CRON_JOBS, cronJob } from "./cronRegistry";
import { jobHealth, needsAttention, humanDuration, HEALTH } from "./cronHealth";
import { setting } from "@/lib/platform/settings";
import { ensureSettings } from "@/lib/platform/settingsStore";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000";

// Once per 12h per job. A job failing every hour must not send 24 emails a day —
// that gets a filter rule written for it, and then the one that matters is
// invisible too.
const FAILURE_COOLDOWN_SECONDS = 12 * 60 * 60;
const WATCHDOG_COOLDOWN_SECONDS = 12 * 60 * 60;
// The watchdog is a side effect of an unrelated job's run, so it must not run
// on every single execution of an hourly job.
const WATCHDOG_THROTTLE_SECONDS = 60 * 60;

function alertRecipient() {
  // Settings page first, then SUPER_ADMIN_EMAIL. If neither is set every alert
  // in this file is skipped silently — which is why the operations dashboard
  // shows it in red.
  return (setting("ENTITLEMENT_ALERT_EMAIL") || process.env.SUPER_ADMIN_EMAIL || "")
    .trim()
    .toLowerCase();
}

/**
 * Wrap a cron handler so the run is recorded whatever happens.
 *
 * ## The contract
 *
 * `fn` returns whatever it wants; if it returns `{ summary }`, that is what
 * lands on the row. It may throw — the throw is recorded, an email goes out,
 * and the error is re-thrown so the route still answers 500 and cron-job.org
 * still sees a failure on its side.
 *
 * ## Why every run watchdogs every other job
 *
 * The obvious design is a dedicated "check the crons" cron. It has an obvious
 * hole: it is itself a cron, so the day it stops, the thing that would have
 * told you it stopped is the thing that stopped.
 *
 * Instead, any job that runs checks all the others. Six jobs on four different
 * schedules would all have to die in the same window for the alarm to go
 * unraised — and if they do, the operations dashboard still computes health on
 * read, with nothing scheduled at all.
 *
 * @param key  a CRON_JOBS key
 * @param fn   async ({ dryRun, req }) => any
 */
export function withCronRun(key, fn) {
  return async function tracked(context = {}) {
    const { dryRun = false, trigger = "cron", actorUserId = null } = context;
    const job = cronJob(key);
    const startedAt = new Date();

    await connectDB();
    // One refresh per run, so a setting changed in the UI is in force on the
    // next scheduled execution rather than whenever an instance recycles.
    await ensureSettings().catch(() => {});

    let run = null;
    try {
      run = await CronRun.create({ job: key, startedAt, ok: false, dryRun, trigger, actorUserId });
    } catch (err) {
      // Recording must never be the reason a job does not run. A cron that
      // refuses to purge because its own logging collection is unhappy is a
      // worse outcome than a purge with no row to show for it.
      console.error(`[cron:${key}] could not open a run row:`, err.message);
    }

    try {
      const result = await fn(context);
      const summary = extractSummary(result);
      const tookMs = Date.now() - startedAt.getTime();

      if (run) {
        await CronRun.updateOne(
          { _id: run._id },
          { $set: { ok: true, finishedAt: new Date(), tookMs, summary } },
        ).catch(() => {});
      }

      // Only a real run watchdogs. A dry run is somebody poking at it from the
      // dashboard, and should not be able to fire alerts.
      if (!dryRun) {
        const alerted = await watchdog(key).catch((err) => {
          console.error(`[cron:${key}] watchdog failed:`, err.message);
          return [];
        });
        if (run && alerted.length) {
          await CronRun.updateOne({ _id: run._id }, { $set: { alertedJobs: alerted } }).catch(() => {});
        }
      }

      return result;
    } catch (err) {
      const tookMs = Date.now() - startedAt.getTime();
      const message = String(err?.stack || err?.message || err).slice(0, 2000);

      if (run) {
        await CronRun.updateOne(
          { _id: run._id },
          { $set: { ok: false, finishedAt: new Date(), tookMs, error: message } },
        ).catch(() => {});
      }

      console.error(`[cron:${key}] failed:`, message);
      if (!dryRun) await alertFailure(job, err).catch(() => {});

      // Re-thrown deliberately. Swallowing it would give cron-job.org a 200 and
      // a green tick for a job that did nothing — the exact false reassurance
      // this file exists to remove.
      throw err;
    }
  };
}

/** A handler may return { summary } explicitly, or a small plain object. */
function extractSummary(result) {
  if (!result || typeof result !== "object") return {};
  if (result.summary && typeof result.summary === "object") return capped(result.summary);
  const { results, rows, items, societies, ...rest } = result;
  return capped(rest);
}

// Keeps a runaway handler from writing a megabyte into the ops collection.
function capped(obj) {
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (n++ >= 20) break;
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) {
      out[k] = typeof v === "string" ? v.slice(0, 200) : v;
    } else if (Array.isArray(v)) {
      out[k] = `${v.length} item(s)`;
    }
  }
  return out;
}

/**
 * Check every OTHER job and email if any is stale, failing or never-run.
 * Returns the keys alerted on.
 */
export async function watchdog(triggeredByKey = null) {
  const throttleKey = "cron-watchdog:last";
  if (await cache.get(throttleKey)) return [];
  await cache.set(throttleKey, "1", WATCHDOG_THROTTLE_SECONDS);

  const rows = await collectHealth();
  const bad = rows.filter(
    (r) => needsAttention(r.state) && r.key !== triggeredByKey,
  );
  if (!bad.length) return [];

  const to = alertRecipient();
  if (!to || !to.includes("@")) {
    console.warn("[cron watchdog] jobs need attention but no alert recipient is configured:", bad.map((b) => b.key));
    return [];
  }

  // One email covering every unhealthy job, cooled down as a set rather than
  // per job — otherwise a platform-wide outage sends six.
  const signature = bad.map((b) => `${b.key}:${b.state}`).sort().join("|");
  const cooldownKey = `cron-watchdog:sent:${signature}`;
  if (await cache.get(cooldownKey)) return [];

  await sendEmail({
    to,
    subject: bad.some((b) => b.critical)
      ? `⚠ ${bad.length} scheduled job(s) not running — something has stopped`
      : `${bad.length} scheduled job(s) need attention`,
    html: watchdogEmailHtml(bad, triggeredByKey),
  });
  await cache.set(cooldownKey, "1", WATCHDOG_COOLDOWN_SECONDS);
  return bad.map((b) => b.key);
}

/**
 * Health for every registered job. Used by the watchdog and by the operations
 * dashboard, so both can never disagree about what "healthy" means.
 */
export async function collectHealth(now = new Date()) {
  await connectDB();

  // One aggregate rather than six queries: newest run per job.
  const latest = await CronRun.aggregate([
    { $sort: { startedAt: -1 } },
    {
      $group: {
        _id: "$job",
        startedAt: { $first: "$startedAt" },
        finishedAt: { $first: "$finishedAt" },
        ok: { $first: "$ok" },
        error: { $first: "$error" },
        tookMs: { $first: "$tookMs" },
        summary: { $first: "$summary" },
        trigger: { $first: "$trigger" },
        dryRun: { $first: "$dryRun" },
      },
    },
  ]);

  const byJob = new Map(latest.map((r) => [r._id, r]));

  return CRON_JOBS.map((job) => {
    // A dry run proves the endpoint answers, not that the schedule fires. It
    // must not count as the job having run, or poking the dashboard would keep
    // resetting the clock and hide a dead schedule indefinitely.
    const last = byJob.get(job.key);
    const health = jobHealth(job, last && !last.dryRun ? last : null, now);
    return {
      key: job.key,
      label: job.label,
      path: job.path,
      cadence: job.cadence,
      schedule: job.schedule,
      critical: job.critical,
      blocks: job.blocks,
      owner: job.owner,
      lastRun: last
        ? {
            startedAt: last.startedAt,
            ok: last.ok,
            dryRun: last.dryRun,
            trigger: last.trigger,
            tookMs: last.tookMs,
            summary: last.summary,
            error: last.error ? String(last.error).slice(0, 400) : null,
          }
        : null,
      ...health,
    };
  });
}

async function alertFailure(job, err) {
  const to = alertRecipient();
  if (!to || !to.includes("@")) return;

  const key = `cron-failure:${job?.key || "unknown"}`;
  if (await cache.get(key)) return;

  await sendEmail({
    to,
    subject: `⚠ Cron failed: ${job?.label || job?.key || "unknown job"}`,
    html: failureEmailHtml(job, err),
  });
  await cache.set(key, "1", FAILURE_COOLDOWN_SECONDS);
}

// ── emails ───────────────────────────────────────────────────────────────
// Both of these say what stopped working, not just what threw. "society-purge
// failed" means nothing at 2am; "soft-deleted societies are not being erased"
// is a sentence somebody can act on.

const SHELL = (inner) =>
  `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto;color:#111">${inner}</div>`;

function failureEmailHtml(job, err) {
  return SHELL(`
    <h2 style="margin:0 0 4px;font-size:18px">${job?.label || job?.key} failed</h2>
    <p style="margin:0 0 20px;color:#666;font-size:13px">${job?.cadence || ""}</p>

    <div style="background:#fef2f2;border-left:3px solid #ef4444;padding:12px 16px;font-size:13.5px;line-height:1.7;margin:0 0 20px">
      <strong>What stops working:</strong><br>${job?.blocks || "Unknown — this job is not described in the registry."}
    </div>

    <p style="font-size:13px;color:#666;margin:0 0 6px">The error:</p>
    <pre style="background:#f8f8f8;padding:12px;border-radius:6px;font-size:12px;overflow-x:auto;white-space:pre-wrap;margin:0 0 20px">${escapeHtml(
      String(err?.stack || err?.message || err).slice(0, 1200),
    )}</pre>

    <p style="margin:24px 0">
      <a href="${APP_URL}/superadmin/operations" style="background:#111;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;font-size:14px">Open the operations dashboard</a>
    </p>
    <p style="color:#666;font-size:12px;line-height:1.6">
      Repeat failures of this job are suppressed for 12 hours so this does not become a stream you filter.
    </p>`);
}

function watchdogEmailHtml(bad, triggeredByKey) {
  const rows = bad
    .map(
      (b) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:13px">
          <strong>${b.label}</strong>${b.critical ? ' <span style="color:#ef4444;font-size:11px">CRITICAL</span>' : ""}
          <div style="color:#666;font-size:12px;margin-top:3px">${b.blocks}</div>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:13px;white-space:nowrap">${labelFor(b.state)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:13px;white-space:nowrap">${
          b.lastRunAt ? `${humanDuration(b.ageMs)} ago` : "never"
        }</td>
      </tr>`,
    )
    .join("");

  const neverRun = bad.filter((b) => b.state === HEALTH.NEVER);

  return SHELL(`
    <h2 style="margin:0 0 4px;font-size:18px">${bad.length} scheduled job(s) are not running</h2>
    <p style="margin:0 0 20px;color:#666;font-size:13px">
      Noticed while <code>${triggeredByKey || "a scheduled job"}</code> was running. Nothing raised an error —
      these jobs are simply not happening, which is why this check exists.
    </p>

    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="background:#f8f8f8">
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666">Job</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666">State</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666">Last run</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    ${
      neverRun.length
        ? `<div style="background:#fffbeb;border-left:3px solid #f59e0b;padding:12px 16px;font-size:13.5px;line-height:1.7;margin:20px 0">
             <strong>${neverRun.length} of these has never run once.</strong> That almost always means it was
             never registered on cron-job.org. The operations dashboard shows the exact line to paste.
           </div>`
        : ""
    }

    <p style="margin:24px 0">
      <a href="${APP_URL}/superadmin/operations" style="background:#111;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;font-size:14px">Open the operations dashboard</a>
    </p>
    <p style="color:#666;font-size:12px;line-height:1.6">
      This repeats at most once every 12 hours while the same set of jobs is unhealthy.
    </p>`);
}

function labelFor(state) {
  return (
    { [HEALTH.NEVER]: "never run", [HEALTH.FAILING]: "failing", [HEALTH.STALE]: "stale", [HEALTH.LATE]: "late" }[
      state
    ] || state
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}

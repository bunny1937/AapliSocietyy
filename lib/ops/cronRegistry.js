/**
 * Every scheduled job on the platform, as data.
 *
 * ## Why this file exists
 *
 * Cron jobs live on cron-job.org, not in this repo. That means the code has no
 * idea what is *supposed* to run — and the failure that follows is the worst
 * kind: a job that was never registered looks exactly like a job that ran and
 * found nothing to do. Both produce silence.
 *
 * Three separate failures across the offboarding and entitlements work all have
 * that shape:
 *
 *   - society-purge never registered  → soft-deleted societies pile up forever
 *   - handover-reminder never registered → purge gate 6 deadlocks, no error
 *   - entitlement-denials never registered → societies knock, nobody hears
 *
 * None of those raise anything. There is nothing to see in a log, because the
 * absence of a run writes no log line.
 *
 * So this file declares what *should* happen. Health is then the difference
 * between this declaration and what CronRun actually recorded — which makes a
 * job that never ran once as loud as a job that ran and threw.
 *
 * ## Adding a job
 *
 * Add it here the same commit you add the route, and wrap the handler in
 * withCronRun(). A job missing from this registry is invisible to the ops
 * dashboard, which is the same silence this file exists to end.
 */

/**
 * @typedef {object} CronJob
 * @property key            stable id; also the CronRun.job value
 * @property path           the route, for the manual-run button and the docs
 * @property label          human name for the dashboard
 * @property cadence        human cadence ("daily 04:00 IST")
 * @property schedule       crontab expression, for pasting into cron-job.org
 * @property intervalMs     how often it is expected to run
 * @property graceMs        how late it may be before we call it late
 * @property critical       true if not running BLOCKS something, rather than
 *                          merely stopping a notification
 * @property blocks         what stops working if it never runs
 * @property owner          which body of work it belongs to
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const CRON_JOBS = [
  {
    key: "retention-scan",
    path: "/v1/cron/retention-scan",
    label: "Retention scan",
    cadence: "daily 02:30 IST",
    schedule: "0 21 * * *", // 02:30 IST = 21:00 UTC previous day
    intervalMs: DAY,
    graceMs: 6 * HOUR,
    critical: false,
    blocks: "Nothing is marked for archival, so the purge below has nothing to act on.",
    owner: "retention",
  },
  {
    key: "retention-purge",
    path: "/v1/cron/retention-purge",
    label: "Retention purge",
    cadence: "daily 03:30 IST",
    schedule: "0 22 * * *",
    intervalMs: DAY,
    graceMs: 6 * HOUR,
    critical: true,
    blocks:
      "Archived records and expired tenancy documents are never removed. We keep personal data past the window we told people we would keep it.",
    owner: "retention",
  },
  {
    key: "society-purge",
    path: "/v1/cron/society-purge",
    label: "Society purge",
    cadence: "daily 04:00 IST",
    schedule: "30 22 * * *",
    intervalMs: DAY,
    graceMs: 6 * HOUR,
    critical: true,
    blocks:
      "Soft-deleted societies are never erased. Nothing errors — purgeScheduledFor is simply never read, and the data sits there indefinitely.",
    owner: "offboarding",
  },
  {
    key: "society-handover-reminder",
    path: "/v1/cron/society-handover-reminder",
    label: "Handover reminder",
    cadence: "weekly, Mon 05:00 IST",
    schedule: "30 23 * * 0", // Mon 05:00 IST = Sun 23:30 UTC
    intervalMs: 7 * DAY,
    graceMs: 2 * DAY,
    critical: true,
    blocks:
      "A society that misses the first handover email is never chased, so purge gate 6 (downloadedAt) never clears and the erasure deadlocks silently. Registering society-purge WITHOUT this one is worse than registering neither — it looks like it should work.",
    owner: "offboarding",
  },
  {
    key: "entitlement-denials",
    path: "/v1/cron/entitlement-denials",
    label: "Entitlement denials",
    cadence: "hourly",
    schedule: "0 * * * *",
    intervalMs: HOUR,
    graceMs: 2 * HOUR,
    critical: false,
    blocks:
      "Denial buckets expire after 3h and the signal is lost. Enforcement is unaffected — the 404s still happen — but nobody hears the societies knocking.",
    owner: "entitlements",
  },
  {
    key: "subscription-lifecycle",
    path: "/v1/cron/subscription-lifecycle",
    label: "Subscription lifecycle",
    cadence: "daily 06:00 IST",
    schedule: "30 0 * * *",
    intervalMs: DAY,
    graceMs: 6 * HOUR,
    critical: false,
    blocks:
      "Societies are never told they lapsed and no blocked-society digest is sent. Enforcement is unaffected — states are derived from nextPaymentDate on every request, so a society goes read-only on time whether or not this runs.",
    owner: "entitlements",
  },
];

/** Jobs whose absence blocks behaviour rather than only silencing a notice. */
export const CRITICAL_JOBS = CRON_JOBS.filter((j) => j.critical);

export const CRON_JOB_KEYS = CRON_JOBS.map((j) => j.key);

export function cronJob(key) {
  return CRON_JOBS.find((j) => j.key === key) || null;
}

/**
 * Cron-job.org sends a bare GET with a bearer token. This is what to paste.
 */
export function cronSetupLine(job, appUrl) {
  return `${job.schedule}  GET ${appUrl}${job.path}   Authorization: Bearer <CRON_SECRET>`;
}

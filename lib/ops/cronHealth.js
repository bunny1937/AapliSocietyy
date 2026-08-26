/**
 * Job health, derived — never stored.
 *
 * Same judgement as the subscription lifecycle: a stored status needs a job to
 * write it, and the day that job fails the status goes stale in exactly the
 * situation it exists to report on. A monitor that needs a monitor is not a
 * monitor.
 *
 * So health is a pure function of (what the registry says should happen, what
 * CronRun recorded, what time it is now). It is correct the instant the clock
 * passes, on every node, with nothing scheduled.
 */

export const HEALTH = {
  OK: "ok",
  LATE: "late", // overdue, but inside the grace window
  STALE: "stale", // overdue past grace — treat as not running
  FAILING: "failing", // it ran, and it threw
  NEVER: "never-run", // no row has ever existed
};

/** Ordered worst-first, so a list can be sorted by "needs attention". */
export const HEALTH_ORDER = [HEALTH.NEVER, HEALTH.FAILING, HEALTH.STALE, HEALTH.LATE, HEALTH.OK];

/**
 * @param job      a CRON_JOBS entry
 * @param lastRun  the newest CronRun for it, or null
 * @param now      Date
 */
export function jobHealth(job, lastRun, now = new Date()) {
  const nowMs = now.getTime();

  // No row has ever been written. This is the failure the whole file is for:
  // a job that was never registered on cron-job.org looks identical to a job
  // that ran and found nothing to do — except that it leaves no row.
  if (!lastRun) {
    return {
      state: HEALTH.NEVER,
      lastRunAt: null,
      ageMs: null,
      overdueByMs: null,
      // A job nobody has ever run is not "slightly late". It is not set up.
      message: `${job.label} has never run. It is probably not registered on cron-job.org.`,
      critical: job.critical,
    };
  }

  const lastAt = new Date(lastRun.startedAt).getTime();
  const ageMs = nowMs - lastAt;
  const overdueByMs = ageMs - job.intervalMs;

  // A failing job that ran ten minutes ago is more urgent than a healthy job
  // that is an hour late, so the error outranks the clock.
  if (lastRun.ok === false) {
    return {
      state: HEALTH.FAILING,
      lastRunAt: lastRun.startedAt,
      ageMs,
      overdueByMs,
      message: `${job.label} last run failed: ${truncate(lastRun.error || "no error recorded", 160)}`,
      critical: job.critical,
    };
  }

  if (overdueByMs > job.graceMs) {
    return {
      state: HEALTH.STALE,
      lastRunAt: lastRun.startedAt,
      ageMs,
      overdueByMs,
      message: `${job.label} has not run for ${humanDuration(ageMs)} — expected every ${humanDuration(job.intervalMs)}.`,
      critical: job.critical,
    };
  }

  if (overdueByMs > 0) {
    return {
      state: HEALTH.LATE,
      lastRunAt: lastRun.startedAt,
      ageMs,
      overdueByMs,
      message: `${job.label} is ${humanDuration(overdueByMs)} overdue, still inside its grace window.`,
      critical: job.critical,
    };
  }

  return {
    state: HEALTH.OK,
    lastRunAt: lastRun.startedAt,
    ageMs,
    overdueByMs,
    message: `${job.label} ran ${humanDuration(ageMs)} ago.`,
    critical: job.critical,
  };
}

/** True when this state is worth waking somebody for. */
export function needsAttention(state) {
  return state === HEALTH.NEVER || state === HEALTH.FAILING || state === HEALTH.STALE;
}

/**
 * The overall verdict for a set of health rows.
 *
 * A non-critical job being stale is a yellow light: the entitlement-denials
 * job not running loses a sales signal, it does not break anybody's product.
 * A critical one being stale is red, because something has quietly stopped
 * happening that people are relying on.
 */
export function overallHealth(rows) {
  if (rows.some((r) => needsAttention(r.state) && r.critical)) return "critical";
  if (rows.some((r) => needsAttention(r.state))) return "degraded";
  if (rows.some((r) => r.state === HEALTH.LATE)) return "late";
  return "ok";
}

export function sortByAttention(rows) {
  return [...rows].sort((a, b) => {
    if (a.critical !== b.critical) return a.critical ? -1 : 1;
    return HEALTH_ORDER.indexOf(a.state) - HEALTH_ORDER.indexOf(b.state);
  });
}

export function humanDuration(ms) {
  if (ms == null) return "—";
  const abs = Math.abs(ms);
  // Tested against the raw value, not the rounded one: 30 seconds rounds up to
  // 1 minute, and "1 minute ago" for a run that just happened reads as staler
  // than it is.
  if (abs < 60000) return "less than a minute";
  const mins = Math.round(abs / 60000);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

function truncate(text, max) {
  const s = String(text);
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

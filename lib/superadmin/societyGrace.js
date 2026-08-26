import { setting } from "@/lib/platform/settings";
// G7 — the grace window as a bounded quantity rather than whatever date got
// typed into a date picker.
//
// Before this, "Delete until <date>" accepted any future date. Tomorrow was
// legal, and so was the year 2140. Neither is a grace window: the first gives
// a society no realistic chance to collect its records before they are gone,
// and the second is indefinite retention wearing a deletion label — the exact
// failure the offboarding flow exists to prevent, just pointing the other way.
//
// So both ends are closed, and both ends are enforced server-side. The UI
// prefills the default and constrains the picker, but the lifecycle route
// re-checks: a date picker is a convenience, never a control.
//
// ## D5 — whose call is it, per society
//
// Answered: the platform's, within hard bounds, and a society can be granted
// more time but never less. The floor exists to protect the society, so no
// operator can shorten it for one — not even with a reason. The ceiling exists
// to stop indefinite retention, so extending past it is itself break-glass and
// is capped again at an absolute maximum.
//
// A society mid-audit, mid-litigation, or waiting on a registrar genuinely
// does need longer than 180 days sometimes. A society nobody wants to deal
// with never needs shorter than 7.

const days = (n) => n * 24 * 60 * 60 * 1000;

// Reads go through lib/platform/settings.js, which resolves
// database override -> environment variable -> code default. The defaults
// documented below are the last of those three, so this file still explains
// the numbers even once a superadmin has changed them from the settings page.
//
// Callers must `await ensureSettings()` somewhere up the stack for a change
// made in the UI to be visible; without it these fall back to env-or-default,
// which is exactly what they did before the settings page existed.

// 30 days is the common notice period in the Model Bye-laws for committee
// business, and long enough that a monthly-meeting cadence gets one chance to
// look at it before the window closes.
export const GRACE_DEFAULT_DAYS = () => setting("SOCIETY_GRACE_DEFAULT_DAYS");
// A week is the floor: enough for the handover email to arrive, be read by
// someone who checks that inbox weekly, and be acted on.
export const GRACE_MIN_DAYS = () => setting("SOCIETY_GRACE_MIN_DAYS");
// Six months is the ceiling. Past that it is not a wind-down, it is storage,
// and it should be an active account or nothing.
export const GRACE_MAX_DAYS = () => setting("SOCIETY_GRACE_MAX_DAYS");

// The hard stop on an extension. Past a year it is not a wind-down under any
// reading, and the society should be an active account again or gone.
export const GRACE_ABSOLUTE_MAX_DAYS = () => setting("SOCIETY_GRACE_ABSOLUTE_MAX_DAYS");

/**
 * @param opts.overrideDays a per-society extension (Society.offboarding
 *        .graceDaysOverride). Widens the ceiling only, never the floor, and is
 *        itself capped at GRACE_ABSOLUTE_MAX_DAYS.
 */
export function graceBounds(from = Date.now(), { overrideDays } = {}) {
  const base = from instanceof Date ? from.getTime() : from;
  const platformMax = GRACE_MAX_DAYS();
  const requested = Number(overrideDays) || 0;
  const maxDays =
    requested > platformMax ? Math.min(requested, GRACE_ABSOLUTE_MAX_DAYS()) : platformMax;
  const defaultDays = Math.min(Math.max(GRACE_DEFAULT_DAYS(), 0), maxDays);
  return {
    minDays: GRACE_MIN_DAYS(),
    maxDays,
    defaultDays,
    overrideDays: maxDays > platformMax ? maxDays : null,
    min: new Date(base + days(GRACE_MIN_DAYS())),
    max: new Date(base + days(maxDays)),
    suggested: new Date(base + days(defaultDays)),
  };
}

/**
 * Validates a requested per-society extension before it is stored.
 * @returns { ok: true, days } | { ok: false, error }
 */
export function validateGraceOverride(requestedDays) {
  const n = Number(requestedDays);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: "A number of days is required" };
  if (n <= GRACE_MAX_DAYS()) {
    return {
      ok: false,
      error: `An extension is only needed beyond the standard ${GRACE_MAX_DAYS()} days — ${n} is already allowed without one.`,
    };
  }
  if (n > GRACE_ABSOLUTE_MAX_DAYS()) {
    return {
      ok: false,
      error: `${n} days exceeds the absolute maximum of ${GRACE_ABSOLUTE_MAX_DAYS()}. Past that it is storage, not a wind-down — reactivate the society instead.`,
    };
  }
  return { ok: true, days: Math.round(n) };
}

/**
 * @returns { ok: true, date } | { ok: false, error }
 */
export function validateGraceDate(until, from = Date.now(), opts = {}) {
  const date = new Date(until);
  if (!until || Number.isNaN(date.getTime())) {
    return { ok: false, error: "A valid date is required" };
  }
  const b = graceBounds(from, opts);
  // Compared by date, not by instant: a window picked as "7 days from today"
  // in the browser is a few hours short of 7×24h by the time it reaches here,
  // and rejecting it would be baffling to the operator who did as asked.
  const endOfMax = new Date(b.max);
  endOfMax.setHours(23, 59, 59, 999);
  const startOfMin = new Date(b.min);
  startOfMin.setHours(0, 0, 0, 0);

  if (date < startOfMin) {
    return {
      ok: false,
      error: `The grace window must be at least ${b.minDays} days — the society needs time to collect its records. Earliest allowed: ${b.min.toISOString().slice(0, 10)}.`,
    };
  }
  if (date > endOfMax) {
    return {
      ok: false,
      error:
        `The grace window cannot exceed ${b.maxDays} days` +
        (b.overrideDays ? " (this society's granted extension)" : "") +
        ` — beyond that we are storing data, not winding an account down. Latest allowed: ${b.max.toISOString().slice(0, 10)}.`,
    };
  }
  return { ok: true, date };
}

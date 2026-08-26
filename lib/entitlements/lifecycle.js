import { setting } from "@/lib/platform/settings";
// Where a society sits in the trial → subscribed → lapsed → blocked story,
// derived from dates rather than stored as a status anybody has to remember to
// update.
//
// ## Why derived and not stored
//
// A stored `status: "Blocked"` needs a job to write it, and the day that job
// fails to run a society keeps full access for free — silently, because
// nothing errored. Deriving it from `trialEndsAt` and `nextPaymentDate` means
// the answer is right the instant the clock passes, on every node, with no
// job at all. The cron that emails people is then a *notifier*, not the
// enforcement — if it dies, people stop being told, but nobody gets free
// access.
//
// See docs/subscriptions-module-docs/00-plan.md §6.

const DAY_MS = 24 * 60 * 60 * 1000;

// Day boundaries after a paid subscription lapses.
// Defaults; both are editable from the superadmin settings page. Resolved
// through lib/platform/settings.js (database -> env -> the numbers below), so
// a caller that has not awaited ensureSettings() still gets a sane value
// rather than undefined.
export const GRACE_DAYS = () => setting("SUBSCRIPTION_GRACE_DAYS"); // days 0..n-1 — everything still works
export const RESTRICTED_DAYS = () => setting("SUBSCRIPTION_RESTRICTED_DAYS"); // read-only until this day; then blocked

export const STATE = {
  TRIAL: "trial",
  ACTIVE: "active",
  GRACE: "grace",
  RESTRICTED: "restricted",
  BLOCKED: "blocked",
};

/** Write access, by state. Read access is universal except when blocked. */
export const STATE_RULES = {
  [STATE.TRIAL]: { read: true, write: true, allModules: true },
  [STATE.ACTIVE]: { read: true, write: true, allModules: false },
  [STATE.GRACE]: { read: true, write: true, allModules: false },
  [STATE.RESTRICTED]: { read: true, write: false, allModules: false },
  // Members keep read access to their own records even here — they did not
  // fail to pay. Enforced by the middleware gate, not by this table.
  [STATE.BLOCKED]: { read: false, write: false, allModules: false },
};

const daysSince = (date, now) => Math.floor((now - new Date(date).getTime()) / DAY_MS);

/**
 * @returns {{
 *   state, daysInState, since, trialEndsAt, expiredAt,
 *   canWrite, canRead, allModules, blockedAt
 * }}
 */
export function societyLifecycle(society, now = Date.now()) {
  const sub = society?.subscription || {};
  const trialEndsAt = sub.trialEndsAt ? new Date(sub.trialEndsAt).getTime() : null;
  const paidUntil = sub.nextPaymentDate ? new Date(sub.nextPaymentDate).getTime() : null;

  // A society that has paid at least once is on the subscription clock, even
  // if its trial window technically has not closed yet — paying early must
  // never move a society into a worse state than not paying.
  const onSubscription = Boolean(paidUntil) && sub.status !== "Trial";

  let state;
  let since;

  if (!onSubscription) {
    if (!trialEndsAt || now < trialEndsAt) {
      state = STATE.TRIAL;
      since = sub.startDate ? new Date(sub.startDate).getTime() : now;
    } else {
      // Trial over with nothing bought. Read-only immediately, no grace: they
      // have paid nothing, so there is nothing to be lenient about, and the
      // read-only state is itself the prompt. It lifts the moment they buy.
      state = STATE.RESTRICTED;
      since = trialEndsAt;
    }
  } else if (now <= paidUntil) {
    state = STATE.ACTIVE;
    since = sub.lastPaymentDate ? new Date(sub.lastPaymentDate).getTime() : paidUntil;
  } else {
    const lapsed = daysSince(paidUntil, now);
    since = paidUntil;
    if (lapsed < GRACE_DAYS()) state = STATE.GRACE;
    else if (lapsed < RESTRICTED_DAYS()) state = STATE.RESTRICTED;
    else state = STATE.BLOCKED;
  }

  const rules = STATE_RULES[state];
  return {
    state,
    since: new Date(since),
    daysInState: Math.max(0, daysSince(since, now)),
    trialEndsAt: trialEndsAt ? new Date(trialEndsAt) : null,
    expiredAt: onSubscription && now > paidUntil ? new Date(paidUntil) : null,
    blockedAt:
      onSubscription && now > paidUntil
        ? new Date(paidUntil + RESTRICTED_DAYS() * DAY_MS)
        : null,
    canRead: rules.read,
    canWrite: rules.write,
    allModules: rules.allModules,
  };
}

/** Human phrasing, reused by banners, emails and the blocked page. */
export function lifecycleMessage(lifecycle, societyName = "This society") {
  switch (lifecycle.state) {
    case STATE.TRIAL:
      return `Free trial — ends ${lifecycle.trialEndsAt?.toLocaleDateString("en-IN") ?? "soon"}.`;
    case STATE.GRACE:
      return `${societyName}'s subscription has ended. Everything still works for now — please renew to avoid interruption.`;
    case STATE.RESTRICTED:
      return lifecycle.expiredAt
        ? `${societyName}'s subscription has ended. The account is read-only until it is renewed — you can still view and export everything.`
        : `The free trial has ended. The account is read-only until a plan is chosen — you can still view and export everything.`;
    case STATE.BLOCKED:
      return `${societyName}'s subscription ended on ${lifecycle.expiredAt?.toLocaleDateString("en-IN")}. Renew to continue, or download your records and close the account.`;
    default:
      return "";
  }
}

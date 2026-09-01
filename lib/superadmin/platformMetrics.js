// Platform-wide metrics for the superadmin dashboard.
//
// Everything in here is computed from rows that actually exist. Where a
// number cannot be derived honestly it is returned as null and the UI says
// so, rather than rendering a confident zero — a fabricated figure on the
// platform console is worse than a blank one, because somebody will act on it.
//
// Two revenue figures, deliberately kept apart:
//   expected  — plan price x active societies. What you should be billing.
//   collected — real payments out of subscription.paymentHistory. What arrived.
// The gap between them is arrears, and it is the most useful number here.

import { setting } from "@/lib/platform/settings";

const PLAN_KEYS = {
  Free: "PLAN_PRICE_FREE",
  Basic: "PLAN_PRICE_BASIC",
  Premium: "PLAN_PRICE_PREMIUM",
  Enterprise: "PLAN_PRICE_ENTERPRISE",
};

export const PLAN_NAMES = Object.keys(PLAN_KEYS);

/** Configured monthly price per plan, in rupees. */
export function planPrices() {
  const out = {};
  for (const [plan, key] of Object.entries(PLAN_KEYS)) {
    out[plan] = Number(setting(key)) || 0;
  }
  return out;
}

/**
 * True when no plan has a price yet. The dashboard uses this to hide every
 * "expected revenue" figure instead of showing ₹0 as though it were a fact.
 */
export function pricesUnconfigured(prices = planPrices()) {
  return Object.values(prices).every((v) => !v);
}

const MS_DAY = 24 * 60 * 60 * 1000;
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const monthKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * Collected revenue per month for the last `months` months, oldest first.
 * Reads every society's paymentHistory — these are recorded payments, not
 * projections.
 */
export function collectedSeries(societies, months = 12) {
  const now = new Date();
  const buckets = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ key: monthKey(d), label: d.toLocaleString("en-IN", { month: "short" }), total: 0 });
  }
  const index = new Map(buckets.map((b) => [b.key, b]));

  for (const s of societies) {
    for (const p of s.subscription?.paymentHistory || []) {
      if (!p?.date || !p?.amount) continue;
      const bucket = index.get(monthKey(new Date(p.date)));
      if (bucket) bucket.total += Number(p.amount) || 0;
    }
  }
  return buckets;
}

/** New societies created per month, oldest first — same window as revenue. */
export function signupSeries(societies, months = 12) {
  const now = new Date();
  const buckets = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ key: monthKey(d), label: d.toLocaleString("en-IN", { month: "short" }), total: 0 });
  }
  const index = new Map(buckets.map((b) => [b.key, b]));
  for (const s of societies) {
    if (!s.createdAt) continue;
    const bucket = index.get(monthKey(new Date(s.createdAt)));
    if (bucket) bucket.total += 1;
  }
  return buckets;
}

/**
 * The replacement for the mockup's invented "health %".
 *
 * Three real signals, each of which can be missing, and the score is only
 * returned when at least one of them could be computed:
 *   collection — paid bills / total bills. A society nobody pays is a society
 *                about to leave.
 *   activity   — did anything happen recently (payment, bill, member added).
 *   standing   — subscription status: suspended/expired drag it down hard.
 *
 * Returns { score, band, reasons } or { score: null } when there is genuinely
 * nothing to judge — a society onboarded yesterday is not "unhealthy", it is
 * unknown, and the UI shows it as such.
 */
export function activitySignal(society, stats) {
  const reasons = [];
  const parts = [];

  const bills = stats?.bills ?? 0;
  const paidBills = stats?.paidBills ?? null;
  if (bills > 0 && paidBills !== null) {
    const rate = paidBills / bills;
    parts.push(rate);
    if (rate < 0.5) reasons.push(`only ${Math.round(rate * 100)}% of bills collected`);
  }

  const last = lastActivityAt(society, stats);
  if (last) {
    const days = Math.floor((Date.now() - last.getTime()) / MS_DAY);
    // Fresh inside a week, dead after ~60.
    parts.push(Math.max(0, Math.min(1, 1 - (days - 7) / 53)));
    if (days > 30) reasons.push(`no activity for ${days} days`);
  }

  const status = society.subscription?.status;
  if (status === "Suspended" || status === "Expired") {
    parts.push(0);
    reasons.push(`subscription ${status.toLowerCase()}`);
  } else if (status === "Active") {
    parts.push(1);
  }

  if (!parts.length) return { score: null, band: "unknown", reasons: ["not enough history yet"] };

  const score = Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100);
  const band = score >= 75 ? "good" : score >= 45 ? "watch" : "risk";
  return { score, band, reasons };
}

/** Most recent real thing that happened, across the signals we have. */
export function lastActivityAt(society, stats) {
  const candidates = [
    stats?.lastBillAt,
    stats?.lastTransactionAt,
    society.subscription?.lastPaymentDate,
    society.updatedAt,
  ]
    .filter(Boolean)
    .map((d) => new Date(d))
    .filter((d) => !Number.isNaN(d.getTime()));
  if (!candidates.length) return null;
  return new Date(Math.max(...candidates.map((d) => d.getTime())));
}

/**
 * Things the operator should do something about today. Every item points at a
 * real society and a real date — no item is generated from a guess.
 */
export function actionItems(rows, prices = planPrices()) {
  const now = Date.now();
  const items = [];

  const trialsEnding = rows.filter((r) => {
    const t = r.subscription?.trialEndsAt;
    if (!t || r.subscription?.status !== "Trial") return false;
    const days = (new Date(t).getTime() - now) / MS_DAY;
    return days >= 0 && days <= 7;
  });
  if (trialsEnding.length) {
    items.push({
      tone: "warning",
      icon: "clock",
      headline: `${trialsEnding.length} trial${trialsEnding.length > 1 ? "s" : ""} ending within 7 days`,
      sub: trialsEnding.slice(0, 3).map((r) => r.name).join(" · "),
      cta: "Review trials",
      href: "/superadmin/subscriptions?filter=trial",
    });
  }

  const expiredTrials = rows.filter((r) => {
    const t = r.subscription?.trialEndsAt;
    return t && r.subscription?.status === "Trial" && new Date(t).getTime() < now;
  });
  if (expiredTrials.length) {
    items.push({
      tone: "danger",
      icon: "alert-triangle",
      headline: `${expiredTrials.length} trial${expiredTrials.length > 1 ? "s have" : " has"} already lapsed`,
      sub: "Still marked Trial with the end date in the past",
      cta: "Resolve",
      href: "/superadmin/subscriptions?filter=trial",
    });
  }

  const overdue = rows.filter((r) => {
    const d = r.subscription?.nextPaymentDate;
    return d && r.subscription?.status === "Active" && new Date(d).getTime() < now;
  });
  if (overdue.length) {
    const amount = pricesUnconfigured(prices)
      ? null
      : overdue.reduce((sum, r) => sum + (prices[r.subscription?.planType] || 0), 0);
    items.push({
      tone: "danger",
      icon: "credit-card",
      headline: `${overdue.length} payment${overdue.length > 1 ? "s" : ""} past due`,
      sub: amount ? `₹${amount.toLocaleString("en-IN")} outstanding` : overdue.slice(0, 3).map((r) => r.name).join(" · "),
      cta: "Chase",
      href: "/superadmin/subscriptions?filter=overdue",
    });
  }

  const suspended = rows.filter((r) => r.subscription?.status === "Suspended");
  if (suspended.length) {
    items.push({
      tone: "danger",
      icon: "pause",
      headline: `${suspended.length} societ${suspended.length > 1 ? "ies" : "y"} suspended`,
      sub: suspended.slice(0, 3).map((r) => r.name).join(" · "),
      cta: "Review",
      href: "/superadmin/subscriptions?filter=suspended",
    });
  }

  const quiet = rows.filter((r) => r.signal?.band === "risk");
  if (quiet.length) {
    items.push({
      tone: "warning",
      icon: "activity",
      headline: `${quiet.length} societ${quiet.length > 1 ? "ies" : "y"} at risk`,
      sub: quiet.slice(0, 3).map((r) => `${r.name} — ${r.signal.reasons[0]}`).join(" · "),
      cta: "See why",
      href: "/superadmin/societies",
    });
  }

  if (pricesUnconfigured(prices)) {
    items.push({
      tone: "info",
      icon: "settings",
      headline: "Plan prices are not set",
      sub: "Expected revenue and arrears stay hidden until every plan has a price",
      cta: "Set prices",
      href: "/superadmin/settings",
    });
  }

  return items;
}

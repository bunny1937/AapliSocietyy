// GET /api/admin/metrics — everything the platform dashboard renders.
//
// Computed server-side on purpose. The old dashboard pulled every society and
// derived its four numbers in the browser, which meant the counts it showed
// were whatever the list endpoint happened to include, and anything needing a
// second collection (bills paid, last activity) simply could not be shown.
//
// One aggregation per collection, grouped by society — not one query per
// society. With N societies the previous list route already fired 3N count
// queries; this route is a fixed handful regardless of how many societies
// exist.

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import Member from "@/models/Member";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import AuditLog from "@/models/AuditLog";
import SocietyHandover from "@/models/SocietyHandover";
import { validateAdminRequest } from "@/lib/admin-middleware";
import { ensureSettings } from "@/lib/platform/settingsStore";
import { collectHealth } from "@/lib/ops/cronTracker";
import { overallHealth, needsAttention } from "@/lib/ops/cronHealth";
import { purgeQueue, handoverQueue, denialQueue } from "@/lib/ops/queues";
import { offboardingChecklist } from "@/lib/superadmin/offboardingGates";
import { MODULES } from "@/lib/entitlements/modules";
import { normalizeFeatures } from "@/lib/entitlements/resolve";
import {
  planPrices,
  pricesUnconfigured,
  collectedSeries,
  signupSeries,
  activitySignal,
  lastActivityAt,
  actionItems,
  PLAN_NAMES,
} from "@/lib/superadmin/platformMetrics";

export const dynamic = "force-dynamic";

const PAID_STATUSES = ["Paid", "PaymentDone"];

/** id -> value, from an aggregation grouped by societyId. */
function byId(rows, pick = (r) => r.count) {
  const map = new Map();
  for (const r of rows) {
    if (r._id == null) continue;
    map.set(String(r._id), pick(r));
  }
  return map;
}

async function buildOpsSummary() {
  try {
    const now = new Date();
    const [health, purge, handovers, denials] = await Promise.all([
      collectHealth(now).catch(() => []),
      purgeQueue(now).catch(() => []),
      handoverQueue(now).catch(() => []),
      denialQueue(7).catch(() => []),
    ]);
    const rows = Array.isArray(health) ? health : health?.rows || [];
    return {
      cron: {
        overall: rows.length ? overallHealth(rows) : null,
        total: rows.length,
        attention: rows.filter((r) => needsAttention(r)).length,
        failing: rows.filter((r) => r.health === "failing").length,
        never: rows.filter((r) => r.health === "never").length,
      },
      queues: {
        purgeBlocked: purge.filter((r) => r.state === "blocked").length,
        purgeReady: purge.filter((r) => r.state === "ready").length,
        handoversPending: handovers.length,
        denials7d: denials.length,
      },
    };
  } catch {
    // Never let ops reporting break the dashboard.
    return null;
  }
}

export async function GET(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;

  try {
    await connectDB();
    await ensureSettings();

    // Soft-deleted societies are INCLUDED. They are excluded from platform
    // totals below, but they are exactly what the offboarding tracker exists
    // to show — filtering them out here is what made a deletion invisible
    // once it started.
    const societies = await Society.find({})
      .select(
        "name area address contactEmail contactPhone personOfContact registrationNo societyId societyCode subscription features createdAt updatedAt isDeleted deletedAt lifecycleStatus pausedUntil",
      )
      .sort({ createdAt: -1 })
      .lean();

    const [memberRows, billRows, paidRows, txnRows] = await Promise.all([
      Member.aggregate([{ $group: { _id: "$societyId", count: { $sum: 1 } } }]),
      Bill.aggregate([
        { $group: { _id: "$societyId", count: { $sum: 1 }, lastAt: { $max: "$createdAt" } } },
      ]),
      Bill.aggregate([
        { $match: { status: { $in: PAID_STATUSES } } },
        { $group: { _id: "$societyId", count: { $sum: 1 } } },
      ]),
      Transaction.aggregate([
        { $group: { _id: "$societyId", count: { $sum: 1 }, lastAt: { $max: "$date" } } },
      ]),
    ]);

    const members = byId(memberRows);
    const bills = byId(billRows);
    const billsLast = byId(billRows, (r) => r.lastAt);
    const paid = byId(paidRows);
    const txns = byId(txnRows);
    const txnsLast = byId(txnRows, (r) => r.lastAt);

    const handoverRows = await SocietyHandover.aggregate([
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$societyId",
          status: { $first: "$status" },
          notifiedAt: { $first: "$notifiedAt" },
          downloadedAt: { $first: "$downloadedAt" },
          confirmedAt: { $first: "$confirmedAt" },
          reminderCount: { $first: "$reminderCount" },
          recipients: { $first: "$recipients" },
          driftMismatchCount: { $first: "$driftMismatchCount" },
        },
      },
    ]);
    const handovers = new Map(handoverRows.map((h) => [String(h._id), h]));

    const prices = planPrices();
    const unconfigured = pricesUnconfigured(prices);

    const rows = societies.map((s) => {
      const id = String(s._id);
      const stats = {
        members: members.get(id) || 0,
        bills: bills.get(id) || 0,
        paidBills: paid.get(id) || 0,
        transactions: txns.get(id) || 0,
        lastBillAt: billsLast.get(id) || null,
        lastTransactionAt: txnsLast.get(id) || null,
      };
      const plan = s.subscription?.planType || "Free";
      const status = s.subscription?.status || "Trial";
      const collected = (s.subscription?.paymentHistory || []).reduce(
        (sum, p) => sum + (Number(p?.amount) || 0),
        0,
      );
      return {
        _id: id,
        name: s.name,
        area: s.area || s.address || "",
        registrationNo: s.registrationNo || null,
        contactEmail: s.contactEmail || null,
        phone: s.contactPhone || null,
        createdAt: s.createdAt || null,
        societyCode: s.societyId || null,
        lifecycleStatus: s.lifecycleStatus || "Active",
        plan,
        status,
        // Only a society that is Active and on a priced plan is "expected" to
        // pay this month. A trial owes nothing yet, and that distinction is
        // the whole point of keeping expected and collected apart.
        expectedMonthly: status === "Active" ? prices[plan] || 0 : 0,
        lifetimeCollected: collected,
        // What this society has actually bought. Read through
        // normalizeFeatures rather than off the raw sub-document so a module
        // removed from the registry (rbac, 2026-08-27) cannot linger in the
        // console after it stopped meaning anything.
        modules: normalizeFeatures(s.features),
        trialEndsAt: s.subscription?.trialEndsAt || null,
        nextPaymentDate: s.subscription?.nextPaymentDate || null,
        lastPaymentDate: s.subscription?.lastPaymentDate || null,
        stats,
        lastActivityAt: lastActivityAt(s, stats),
        signal: activitySignal(s, stats),
        isDeleted: Boolean(s.isDeleted),
        deletedAt: s.deletedAt || null,
        purgeScheduledFor: s.purgeScheduledFor || null,
        offboarding: offboardingChecklist(s, handovers.get(id) || null),
      };
    });

    // Everything below counts live societies. A society being erased is not
    // part of the platform's members, revenue or plan mix.
    const live = rows.filter((r) => !r.isDeleted);
    const offboarding = rows.filter((r) => r.isDeleted);

    const byStatus = live.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});
    const byPlan = PLAN_NAMES.reduce((acc, p) => {
      const inPlan = live.filter((r) => r.plan === p);
      acc[p] = {
        societies: inPlan.length,
        active: inPlan.filter((r) => r.status === "Active").length,
        expectedMonthly: inPlan.reduce((sum, r) => sum + r.expectedMonthly, 0),
        price: prices[p] || 0,
      };
      return acc;
    }, {});

    const revenue = collectedSeries(societies, 12);
    const signups = signupSeries(societies, 12);
    const thisMonth = revenue[revenue.length - 1]?.total || 0;
    const lastMonth = revenue[revenue.length - 2]?.total || 0;
    const expectedMonthly = live.reduce((sum, r) => sum + r.expectedMonthly, 0);

    // Real platform activity — the audit trail, not a fixture list.
    const auditRows = await AuditLog.find({})
      .select("action societyId userId timestamp")
      .sort({ timestamp: -1 })
      .limit(12)
      .lean();
    const societyNames = new Map(rows.map((r) => [r._id, r.name]));
    const activity = auditRows.map((a) => ({
      id: String(a._id),
      action: a.action,
      society: a.societyId ? societyNames.get(String(a.societyId)) || null : null,
      by: a.userId ? String(a.userId) : null,
      at: a.timestamp || a.createdAt || null,
    }));

    // Platform operations, condensed. The full picture lives on
    // /superadmin/operations; what belongs on the dashboard is only "is
    // anything on fire", with a link through. Each of these can fail
    // independently without taking the dashboard down with it — a broken
    // queue query should not blank the revenue chart.
    const ops = await buildOpsSummary();

    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      ops,
      pricing: { prices, configured: !unconfigured },
      // The add-on catalogue, so the console labels module toggles from the
      // registry instead of a second hardcoded list that can drift from it.
      moduleCatalogue: MODULES.map((m) => ({
        key: m.key,
        label: m.label,
        description: m.description || "",
      })),
      totals: {
        societies: live.length,
        members: live.reduce((s, r) => s + r.stats.members, 0),
        bills: live.reduce((s, r) => s + r.stats.bills, 0),
        paidBills: live.reduce((s, r) => s + r.stats.paidBills, 0),
        transactions: live.reduce((s, r) => s + r.stats.transactions, 0),
        // null, not 0, while prices are unset — the UI hides these entirely
        // rather than claiming the platform earns nothing.
        expectedMonthly: unconfigured ? null : expectedMonthly,
        collectedThisMonth: thisMonth,
        collectedLastMonth: lastMonth,
        arrears: unconfigured ? null : Math.max(0, expectedMonthly - thisMonth),
        lifetimeCollected: live.reduce((s, r) => s + r.lifetimeCollected, 0),
      },
      byStatus,
      byPlan,
      series: { revenue, signups },
      actions: actionItems(live, prices),
      societies: live,
      offboarding,
      activity,
    });
  } catch (error) {
    console.error("[admin/metrics]", error);
    return NextResponse.json(
      { error: `Failed to build metrics: ${error.message}` },
      { status: 500 },
    );
  }
}

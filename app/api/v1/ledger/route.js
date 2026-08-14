import { withRoute, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { Transaction, Bill } from "@/lib/v1/models";
import { BILLING_WRITE_ROLES } from "@/lib/v1/constants";
import { periodLabelFrom } from "@/lib/v1/periodLabel";
import cache from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fetchOwnLedger(societyId, memberId) {
  const [txns, scheduled] = await Promise.all([
    Transaction.find({ societyId, memberId }).sort({ date: -1, createdAt: -1 }).limit(200).lean(),
    Bill.find({ societyId, memberId, status: "Scheduled", isDeleted: { $ne: true } })
      .select("_id billPeriodId")
      .lean(),
  ]);
  const hiddenBillIds = scheduled.map((b) => String(b._id));
  const hiddenPeriods = scheduled.map((b) => b.billPeriodId).filter(Boolean);
  return { txns, hiddenBillIds, hiddenPeriods };
}

// GET /v1/ledger — residents see their own transactions; admins may pass
// ?memberId=. Same reasoning as v1/bills: changes only when a payment is
// recorded (a handful of times a month), all of which explicitly invalidate
// `v1:ledger:<societyId>:member:<memberId>` — long TTL here is a safety net,
// invalidation is what actually keeps it fresh. Only the resident's-own view
// is cached; admin queries go straight to Mongo.
export const GET = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  const url = new URL(req.url);

  if (BILLING_WRITE_ROLES.includes(claims.role)) {
    const query = { societyId };
    const memberId = url.searchParams.get("memberId");
    if (memberId) query.memberId = memberId;
    const txns = await Transaction.find(query).sort({ date: -1, createdAt: -1 }).limit(200).lean();
    return json({
      transactions: txns.map((t) => ({ ...t, _id: String(t._id), periodLabel: periodLabelFrom(t) })),
    });
  }

  // ── Commercial (shop) profile ──
  // models/Transaction.js already carries shopId (mirroring Bill.shopId), so the
  // shop's own statement is a direct query. Scheduled (not yet pushed) bills are
  // hidden here exactly as they are for residents — an owner must not see a
  // charge the society has not sent out yet.
  if (claims.shopId) {
    const [txns, scheduled] = await Promise.all([
      Transaction.find({ societyId, shopId: claims.shopId })
        .sort({ date: -1, createdAt: -1 })
        .limit(200)
        .lean(),
      Bill.find({ societyId, shopId: claims.shopId, status: "Scheduled", isDeleted: { $ne: true } })
        .select("_id billPeriodId")
        .lean(),
    ]);
    const hiddenIds = new Set(scheduled.map((b) => String(b._id)));
    const hiddenPeriodIds = new Set(scheduled.map((b) => b.billPeriodId).filter(Boolean));
    const visibleTxns = txns.filter((t) => {
      const ref = t.referenceId ? String(t.referenceId) : null;
      return !(ref && hiddenIds.has(ref)) && !hiddenPeriodIds.has(t.billPeriodId);
    });
    return json({
      transactions: visibleTxns.map((t) => ({ ...t, _id: String(t._id), periodLabel: periodLabelFrom(t) })),
    });
  }

  if (!claims.memberId) return json({ transactions: [] });

  const { txns, hiddenBillIds, hiddenPeriods } = await cache.getOrSetSWR(
    `v1:ledger:${societyId}:member:${claims.memberId}`,
    () => fetchOwnLedger(societyId, claims.memberId),
    { softTtlSeconds: 21600, hardTtlSeconds: 86400 },
  );
  const hiddenBillIdSet = new Set(hiddenBillIds);
  const hiddenPeriodSet = new Set(hiddenPeriods);
  const visible = txns.filter((t) => {
    const ref = t.referenceId ? String(t.referenceId) : null;
    return !(ref && hiddenBillIdSet.has(ref)) && !hiddenPeriodSet.has(t.billPeriodId);
  });
  return json({
    transactions: visible.map((t) => ({ ...t, _id: String(t._id), periodLabel: periodLabelFrom(t) })),
  });
});

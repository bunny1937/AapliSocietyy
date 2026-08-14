import { withRoute, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { Receipt } from "@/lib/v1/models";
import { BILLING_WRITE_ROLES } from "@/lib/v1/constants";
import { periodLabelFrom } from "@/lib/v1/periodLabel";
import cache from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /v1/receipts — residents see their own receipts; admins may pass
// ?memberId=. A receipt is created once, at payment time, and never changes
// after — the longest-lived of the three billing caches is appropriate
// here. Invalidated by the same payment-recording routes as bills/ledger.
export const GET = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  const url = new URL(req.url);

  if (BILLING_WRITE_ROLES.includes(claims.role)) {
    const query = { societyId };
    const memberId = url.searchParams.get("memberId");
    if (memberId) query.memberId = memberId;
    const receipts = await Receipt.find(query).sort({ paidAt: -1, createdAt: -1 }).limit(200).lean();
    return json({
      receipts: receipts.map((r) => ({ ...r, _id: String(r._id), periodLabel: periodLabelFrom(r) })),
    });
  }

  if (!claims.memberId) return json({ receipts: [] });

  const receipts = await cache.getOrSetSWR(
    `v1:receipts:${societyId}:member:${claims.memberId}`,
    () => Receipt.find({ societyId, memberId: claims.memberId }).sort({ paidAt: -1, createdAt: -1 }).limit(200).lean(),
    { softTtlSeconds: 21600, hardTtlSeconds: 86400 },
  );
  return json({
    receipts: receipts.map((r) => ({ ...r, _id: String(r._id), periodLabel: periodLabelFrom(r) })),
  });
});

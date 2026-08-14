import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims, requireRoles, requireTenant } from "@/lib/v1/auth";
import { billCreateSchema } from "@/lib/v1/schemas";
import { Bill, Member } from "@/lib/v1/models";
import { BILLING_WRITE_ROLES } from "@/lib/v1/constants";
import { billWritesEnabled } from "@/lib/v1/config";
import { normalizeBill } from "@/lib/v1/billUtils";
import { notifyBillCreated } from "@/lib/v1/notify";
import cache from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fetchOwnBills(societyId, memberId) {
  const bills = await Bill.find({ societyId, memberId, status: { $ne: "Scheduled" } })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  const member = await Member.findById(memberId)
    .select("flatNo wing ownerName carpetAreaSqft builtUpAreaSqft")
    .lean();
  return { bills, member };
}

// GET /v1/bills — residents see their own bills; admins may pass ?memberId=.
//
// Bills change only when a bill is generated/pushed or a payment is
// recorded — a handful of times a month, from routes that all explicitly
// invalidate `v1:bills:<societyId>:member:<memberId>` (billing/generate,
// bills/push-scheduled, payments/record, v1/bills/[id]/pay). Everything in
// between is the *same* data read over and over by every resident, so a
// long TTL here is safe: the soft/hard TTLs below are a safety net for a
// missed invalidation, not the thing keeping this fresh day-to-day.
//
// Only the resident's-own view is cached (the common, high-fanout case —
// one member reads their own bills, but a whole society's worth of members
// hit the same handful of underlying documents). Admin queries (?memberId=,
// ?status=) go straight to Mongo — admins are few, want live data while
// working, and the filter combinations don't repeat enough to be worth
// caching.
export const GET = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  const url = new URL(req.url);

  if (BILLING_WRITE_ROLES.includes(claims.role)) {
    const query = { societyId };
    const memberId = url.searchParams.get("memberId");
    if (memberId) query.memberId = memberId;
    const status = url.searchParams.get("status");
    if (status) query.status = status;

    const bills = await Bill.find(query).sort({ createdAt: -1 }).limit(200);
    const memberIds = [...new Set(bills.map((b) => String(b.memberId)))];
    const members = await Member.find({ _id: { $in: memberIds } }).select("flatNo wing ownerName carpetAreaSqft builtUpAreaSqft").lean();
    const byId = new Map(members.map((m) => [String(m._id), m]));
    return json({ bills: bills.map((b) => normalizeBill(b, byId.get(String(b.memberId)))) });
  }

  if (!claims.memberId) return json({ bills: [] });

  const { bills, member } = await cache.getOrSetSWR(
    `v1:bills:${societyId}:member:${claims.memberId}`,
    () => fetchOwnBills(societyId, claims.memberId),
    { softTtlSeconds: 21600, hardTtlSeconds: 86400 }, // 6h soft / 24h hard
  );
  return json({ bills: bills.map((b) => normalizeBill(b, member)) });
});

// POST /v1/bills — create a one-off bill. GATED by BILL_WRITES_ENABLED (off by
// default) so the mobile layer never generates bills unless explicitly opted in
// (the web app owns the canonical billing engine).
export const POST = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  requireRoles(claims, BILLING_WRITE_ROLES);
  if (!billWritesEnabled()) throw new ApiError(403, "Bill creation from the mobile app is disabled");

  const body = await req.json().catch(() => ({}));
  const parsed = billCreateSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);
  const data = parsed.data;

  const member = await Member.findOne({ _id: data.memberId, societyId }).select("_id");
  if (!member) throw new ApiError(404, "Member not found");

  const bill = await Bill.create({
    societyId,
    memberId: member._id,
    period: data.period,
    title: data.title,
    principal: data.amount,
    amount: data.amount,
    amountPaid: 0,
    status: "Unpaid",
    dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
  });

  await notifyBillCreated({ billId: bill._id, societyId, memberId: member._id, amount: data.amount });
  await cache.del(`v1:bills:${societyId}:member:${member._id}`);
  return json({ bill }, { status: 201 });
});
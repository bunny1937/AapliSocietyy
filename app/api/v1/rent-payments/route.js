import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { rentPaymentCreateSchema } from "@/lib/v1/schemas";
import { RentPayment, Member } from "@/lib/v1/models";
import { SOCIETY_ADMIN_ROLES } from "@/lib/v1/constants";
import { notifyRentPaymentSubmitted } from "@/lib/v1/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /v1/rent-payments — admins see the whole society, owner and tenant both
// see their own flat's records (tenants previously saw nothing).
export const GET = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  const query = { societyId, isDeleted: { $ne: true } };
  if (!SOCIETY_ADMIN_ROLES.includes(claims.role)) {
    if (!claims.memberId) return json({ rentPayments: [] });
    query.memberId = claims.memberId;
  }
  const rentPayments = await RentPayment.find(query).sort({ paidAt: -1 }).limit(200).lean();
  return json({
    rentPayments: rentPayments.map((r) => ({
      ...r,
      _id: String(r._id),
      status: r.status || "Confirmed",
      submittedByRole: r.submittedByRole || "Owner",
      canConfirm: claims.occupancyType !== "Tenant" && (r.status || "Confirmed") === "Pending",
    })),
    viewerRole: claims.occupancyType === "Tenant" ? "Tenant" : "Owner",
  });
});

// POST /v1/rent-payments — tenants submit a payment for confirmation, owners
// record a confirmed payment directly. Tenants are no longer blocked outright.
export const POST = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  if (!claims.memberId) throw new ApiError(403, "No flat linked to this account");
  const body = await req.json().catch(() => ({}));
  const parsed = rentPaymentCreateSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);
  const data = parsed.data;

  const member = await Member.findOne({ _id: claims.memberId, societyId })
    .select("_id flatNo wing ownerName currentTenant")
    .lean();
  if (!member) throw new ApiError(404, "Member not found");

  const isTenant = claims.occupancyType === "Tenant";
  const rentPayment = await RentPayment.create({
    societyId,
    memberId: member._id,
    recordedByUserId: claims.userId,
    month: data.month,
    amount: data.amount,
    paymentMode: data.paymentMode,
    paidAt: new Date(data.paidAt),
    notes: data.notes,
    reference: body.reference || undefined,
    submittedByRole: isTenant ? "Tenant" : "Owner",
    status: isTenant ? "Pending" : "Confirmed",
    confirmedByUserId: isTenant ? undefined : claims.userId,
    confirmedAt: isTenant ? undefined : new Date(),
  });

  // Push + in-app to the owner so the confirmation happens in the app.
  if (isTenant) {
    await notifyRentPaymentSubmitted({
      societyId,
      member,
      rentPayment: rentPayment.toObject(),
      tenantName: member?.currentTenant?.name || "Your tenant",
    }).catch((e) => console.warn("rent submit notify failed", e?.message));
  }

  return json(
    {
      rentPayment: { ...rentPayment.toObject(), _id: String(rentPayment._id) },
      message: isTenant
        ? "Payment submitted. Your owner will confirm it."
        : "Rent payment recorded.",
    },
    { status: 201 },
  );
});

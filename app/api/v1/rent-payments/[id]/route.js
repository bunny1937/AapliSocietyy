import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { RentPayment } from "@/lib/v1/models";
import { notifyRentPaymentDecision } from "@/lib/v1/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EDITABLE_FIELDS = ["amount", "paymentMode", "month", "notes", "reference"];

async function loadOwned(req, id) {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  if (claims.occupancyType === "Tenant") throw new ApiError(403, "Only the owner can manage rent records");
  const payment = await RentPayment.findOne({ _id: id, societyId, memberId: claims.memberId, isDeleted: { $ne: true } });
  if (!payment) throw new ApiError(404, "Rent payment not found");
  return { claims, societyId, payment };
}

// PATCH — confirm, reject, or edit a rent record (owner CRUD).
export const PATCH = withRoute(async (req, { params }) => {
  const { claims, payment } = await loadOwned(req, params.id);
  const body = await req.json().catch(() => ({}));
  const action = body.action;

  if (action === "confirm" || action === "reject") {
    // A decision can only be made once. Re-confirming a Rejected record (or
    // vice versa) would silently flip an already-communicated outcome.
    if (payment.status !== "Pending") {
      throw new ApiError(409, `This record is already ${payment.status.toLowerCase()} and cannot be re-decided`);
    }
    payment.status = action === "confirm" ? "Confirmed" : "Rejected";
    payment.confirmedByUserId = claims.userId;
    payment.confirmedAt = new Date();
    if (action === "reject") payment.rejectionReason = body.reason || "Not received";
    await payment.save();
    await notifyRentPaymentDecision({
      societyId: payment.societyId,
      memberId: payment.memberId,
      rentPayment: payment.toObject(),
      approved: action === "confirm",
    }).catch((e) => console.warn("rent decision notify failed", e?.message));
    return json({ rentPayment: { ...payment.toObject(), _id: String(payment._id) } });
  }

  // Field edits. LOOP-03: a Tenant-submitted record that has already been
  // Confirmed or Rejected is a decision both sides have seen — it is locked
  // against silent edits from here on. Only an owner's own direct entries
  // (never submitted by a tenant for approval) stay editable, since nobody
  // but the owner ever relied on that figure.
  const editRequested = EDITABLE_FIELDS.some((f) => body[f] !== undefined) || body.paidAt !== undefined;
  if (editRequested) {
    const locked = payment.submittedByRole === "Tenant" && payment.status !== "Pending";
    if (locked) {
      throw new ApiError(409, "This record was confirmed/rejected against a tenant submission and can no longer be edited directly");
    }

    const nextAmount = body.amount !== undefined ? Number(body.amount) : payment.amount;
    if (!(nextAmount > 0)) throw new ApiError(400, "Amount must be greater than zero");
    let nextPaidAt = payment.paidAt;
    if (body.paidAt) {
      nextPaidAt = new Date(body.paidAt);
      if (Number.isNaN(nextPaidAt.getTime())) throw new ApiError(400, "Invalid paidAt date");
      if (nextPaidAt.getTime() > Date.now()) throw new ApiError(400, "paidAt cannot be in the future");
    }

    const previous = {};
    for (const field of EDITABLE_FIELDS) {
      if (body[field] !== undefined && body[field] !== payment[field]) previous[field] = payment[field];
    }
    if (body.paidAt && nextPaidAt.getTime() !== payment.paidAt.getTime()) {
      previous.paidAt = payment.paidAt;
    }
    if (Object.keys(previous).length > 0) {
      payment.editHistory = payment.editHistory || [];
      payment.editHistory.push({ editedByUserId: claims.userId, editedAt: new Date(), previous });
    }

    for (const field of EDITABLE_FIELDS) {
      if (body[field] !== undefined) payment[field] = field === "amount" ? nextAmount : body[field];
    }
    payment.paidAt = nextPaidAt;
    await payment.save();
  }

  return json({ rentPayment: { ...payment.toObject(), _id: String(payment._id) } });
});

// Soft delete only (LOOP-03): a hard delete destroyed the audit trail this
// module otherwise builds via editHistory. Deleted records are excluded from
// loadOwned() and the list endpoint but remain in the collection.
export const DELETE = withRoute(async (req, { params }) => {
  const { claims, payment } = await loadOwned(req, params.id);
  payment.isDeleted = true;
  payment.deletedAt = new Date();
  payment.deletedByUserId = claims.userId;
  await payment.save();
  return json({ success: true });
});

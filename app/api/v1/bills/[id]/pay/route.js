import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims, requireRoles, requireTenant } from "@/lib/v1/auth";
import { paymentSchema } from "@/lib/v1/schemas";
import { Bill, Member, Payment, Transaction, Receipt } from "@/lib/v1/models";
import { BILLING_WRITE_ROLES } from "@/lib/v1/constants";
import { applyPaymentToBill } from "@/lib/billing/allocationService";
import { normalizeBill, newTransactionId } from "@/lib/v1/billUtils";
import { issueReceiptNo } from "@/lib/billing/receiptIssuance";
import { periodLabelFrom } from "@/lib/v1/periodLabel";
import { notifyPaymentReceived } from "@/lib/v1/notify";
import { postPaymentToLedger } from "@/lib/accounting/paymentLedgerPosting";
import cache from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /v1/bills/:id/pay — admin/secretary records a payment against a bill.
// Interest is cleared before principal; any overpayment becomes member
// advanceCredit. Mirrors the mobile bill-pay controller (Payment + Transaction
// + Receipt written together).
export const POST = withRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  requireRoles(claims, BILLING_WRITE_ROLES);

  const body = await req.json().catch(() => ({}));
  const parsed = paymentSchema.partial({ billId: true }).safeParse({ ...body, billId: body.billId ?? id });
  if (!parsed.success) throw zodError(parsed);
  const { amount, paymentMode } = parsed.data;

  const bill = await Bill.findOne({ _id: id, societyId });
  if (!bill) throw new ApiError(404, "Bill not found");
  if (bill.status === "Paid") throw new ApiError(409, "Bill already paid");

  // Ledger V2 (§14): at most one bill carries the outstanding balance at a
  // time — every generation absorbs the previous bill's full closing state
  // into its own opening. Paying an OLDER bill after a newer one already
  // exists would change that older bill's closingPrincipal/closingInterest
  // without updating the newer bill's already-frozen opening — an instant
  // P1 carry-forward break. Only the member's latest bill is payable.
  const newerBillExists = await Bill.exists({
    societyId,
    memberId: bill.memberId,
    billPeriodId: { $gt: bill.billPeriodId ?? bill.period },
  });
  if (newerBillExists) {
    throw new ApiError(
      409,
      "This bill has been superseded by a newer one — only the current bill can be paid. Any remaining balance already carried forward.",
    );
  }

  // Ledger V2: all allocation math, invariant checks, and the audit event
  // live inside applyPaymentToBill() — nothing computed independently here.
  let result;
  try {
    result = await applyPaymentToBill({
      billId: bill._id,
      payment: amount,
      performedBy: claims.userId,
    });
  } catch (err) {
    if (err.code === "NEGATIVE_PAYMENT") throw new ApiError(400, err.message);
    if (err.code && /^[BP]\d/.test(err.code)) throw new ApiError(422, `Invariant ${err.code}: ${err.message}`);
    throw err;
  }
  if (result.skipped) throw new ApiError(409, `Payment not applied (${result.skipped})`);

  const advanceCredit = result.advanceCredit;
  const breakdown = { interestCleared: result.interestPaid, principalCleared: result.principalPaid };
  // Re-fetch: applyPaymentToBill wrote through the canonical model, so this
  // v1-shaped `bill` doc is stale on amountPaid/balanceAmount/status now.
  const freshBill = await Bill.findById(bill._id);

  const receiptNo = await issueReceiptNo(bill);
  const transactionId = newTransactionId();
  const label = periodLabelFrom(bill);

  const [payment, transaction, receipt] = await Promise.all([
    Payment.create({ societyId, billId: bill._id, memberId: bill.memberId, amount, paymentMode }),
    Transaction.create({
      transactionId,
      date: new Date(),
      societyId,
      memberId: bill.memberId,
      createdBy: claims.userId,
      type: "Credit",
      category: "Maintenance",
      description: `Payment received for ${label}`,
      amount,
      referenceId: bill._id,
      referenceModel: "Bill",
      billPeriodId: bill.billPeriodId ?? bill.period,
      paymentMode,
      interestCleared: Number(breakdown.interestCleared),
      principalCleared: Number(breakdown.principalCleared),
      paymentBreakdown: breakdown,
    }),
    Receipt.create({
      receiptNo,
      billId: bill._id,
      billPeriodId: bill.billPeriodId ?? bill.period,
      memberId: bill.memberId,
      societyId,
      unitClass: bill.unitClass,
      billSeries: bill.billSeries,
      amount,
      paymentMode,
      paidAt: new Date(),
      transactionId,
      status: "Generated",
    }),
  ]);

  if (advanceCredit > 0) {
    await Member.updateOne({ _id: bill.memberId }, { $inc: { advanceCredit } });
  }

  // Phase 2.6 producer-wiring (docs/accounting-system-ARD.md §8 build note):
  // no caller-owned session here either (Payment/Transaction/Receipt above
  // are already written outside a shared transaction) — same smaller
  // atomicity window as billing-simulator/pay-real, not a regression.
  try {
    await postPaymentToLedger(societyId, {
      transaction,
      paymentMode,
      actorUserId: claims.userId,
    });
  } catch (err) {
    throw new ApiError(err.status || 500, err.message);
  }

  await notifyPaymentReceived({ transactionId: transaction._id, societyId, memberId: bill.memberId, amount });

  await cache.del(
    `v1:bills:${societyId}:member:${bill.memberId}`,
    `v1:ledger:${societyId}:member:${bill.memberId}`,
    `v1:receipts:${societyId}:member:${bill.memberId}`,
  );

  const member = await Member.findById(bill.memberId).lean();
  return json({
    bill: normalizeBill(freshBill, member),
    payment: { _id: String(payment._id), amount, paymentMode },
    receipt: { _id: String(receipt._id), receiptNo },
    advanceCredit,
    breakdown,
  });
});

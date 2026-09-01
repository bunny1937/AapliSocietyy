import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { getFinancialYear } from "@/lib/date-utils";
import { applyPaymentToBill } from "@/lib/billing/allocationService";
import { postPaymentToLedger } from "@/lib/accounting/paymentLedgerPosting";
import { authorize } from "@/lib/rbac/authorize";
import cache from "@/lib/cache";

function twoDp(n) {
  return parseFloat((Number(n) || 0).toFixed(2));
}

// Ledger V2: THIN WRAPPER over the shared AllocationEngine. No allocation math
// of its own — it locates the target bill, delegates allocation + audit to
// applyPaymentToBill (interest-first, idempotent, atomic), then records the
// credit Transaction from the engine's result.
export async function POST(request) {
  try {
    const gate = await authorize(request, "finance.payment.record");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    if (decoded.role === "Accountant" || decoded.role === "Member")
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

    const { memberId, billPeriodId, amount, paymentDate, paymentMethod, remarks } = await request.json();
    if (!memberId || !billPeriodId || !amount)
      return NextResponse.json({ error: "memberId, billPeriodId, amount required" }, { status: 400 });
    if (amount <= 0) return NextResponse.json({ error: "amount must be > 0" }, { status: 400 });

    const bill = await Bill.findOne({
      memberId,
      societyId: decoded.societyId,
      billPeriodId,
      isDeleted: { $ne: true },
    }).select("_id status");
    if (!bill) return NextResponse.json({ error: `No bill found for ${billPeriodId}` }, { status: 404 });

    let result;
    try {
      result = await applyPaymentToBill({
        billId: bill._id,
        payment: twoDp(amount),
        performedBy: decoded.userId,
      });
    } catch (err) {
      if (err.code === "NEGATIVE_PAYMENT") return NextResponse.json({ error: err.message }, { status: 400 });
      if (err.code && /^[BP]\d/.test(err.code)) return NextResponse.json({ error: `Invariant ${err.code}: ${err.message}` }, { status: 422 });
      throw err;
    }
    if (result.skipped)
      return NextResponse.json({ success: false, skipped: result.skipped, billId: bill._id }, { status: 409 });

    const member = await Member.findById(memberId).select("openingBalance").lean();
    const txDate = paymentDate ? new Date(paymentDate) : new Date();
    const lastTxn = await Transaction.findOne({ memberId, societyId: decoded.societyId, isReversed: false })
      .sort({ date: -1, createdAt: -1 })
      .lean();
    const prevBal = twoDp(lastTxn?.balanceAfterTransaction ?? member?.openingBalance ?? 0);

    const txn = await Transaction.create({
      transactionId: Transaction.generateTransactionId(),
      date: txDate,
      memberId,
      societyId: decoded.societyId,
      type: "Credit",
      category: "Payment",
      description: `Payment via simulator (real mode) for ${billPeriodId}${remarks ? ` - ${remarks}` : ""}`,
      amount: twoDp(amount),
      interestCleared: result.interestPaid,
      principalCleared: result.principalPaid,
      balanceAfterTransaction: twoDp(prevBal - amount),
      paymentMode: paymentMethod || "Cash",
      notes: remarks,
      createdBy: decoded.userId,
      billPeriodId,
      financialYear: getFinancialYear(txDate),
      paymentBreakdown: {
        interestCleared: result.interestPaid,
        principalCleared: result.principalPaid,
        advanceCredit: result.advanceCredit,
      },
    });

    // Phase 2.6 producer-wiring (docs/accounting-system-ARD.md §8 build note):
    // this route has no caller-owned session (applyPaymentToBill owns and
    // closes its own transaction internally), so the ledger post runs in the
    // engine's own separate transaction right after the Transaction commits —
    // a smaller atomicity window than PaymentService's fully joined-session
    // version, but not worse than this route's pre-existing lack of
    // end-to-end session wrapping across Bill + Transaction.
    //
    // appliedToDues/advance MUST be passed — postPaymentToLedger defaults
    // appliedToDues to the WHOLE payment amount when omitted, which posts
    // 100% of any overpayment to Member Receivable instead of splitting it
    // against the Advance-From-Members liability. That's the exact "Member
    // Receivable went negative" bug this file's own header describes as
    // fixed elsewhere — this route had the fix available (result.advanceCredit,
    // right above) but never forwarded it. Fail-soft: the Bill/Transaction
    // already committed above, so a ledger-posting error here must not
    // report the whole payment as failed.
    let ledgerFailed = false;
    try {
      await postPaymentToLedger(decoded.societyId, {
        transaction: txn,
        paymentMode: paymentMethod,
        paymentDate,
        notes: remarks,
        actorUserId: decoded.userId,
        appliedToDues: twoDp(amount - (result.advanceCredit || 0)),
        advance: twoDp(result.advanceCredit || 0),
      });
    } catch (err) {
      ledgerFailed = true;
      console.error(`pay-real: postPaymentToLedger failed for txn ${txn.transactionId}:`, err.message);
    }

    // Real payment against a real bill, same as the non-simulator pay route.
    await cache.del(
      `v1:bills:${decoded.societyId}:member:${memberId}`,
      `v1:ledger:${decoded.societyId}:member:${memberId}`,
    );

    return NextResponse.json({
      success: true,
      transactionId: txn.transactionId,
      billPeriodId,
      amountPaid: twoDp(amount),
      interestCleared: result.interestPaid,
      principalCleared: result.principalPaid,
      advanceCredit: result.advanceCredit,
      primaryBillId: bill._id,
      status: result.status,
      ...(ledgerFailed
        ? { warning: "Payment recorded, but it could not be posted to Accounting. Fix this on the Vouchers page." }
        : {}),
    });
  } catch (err) {
    console.error("pay-real error:", err);
    if (err.status) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    return NextResponse.json({ error: "Internal server error", details: err.message }, { status: 500 });
  }
}

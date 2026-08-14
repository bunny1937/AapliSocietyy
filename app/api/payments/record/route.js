import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { getFinancialYear } from "@/lib/date-utils";
import AuditLog from "@/models/AuditLog";
import { getBillPayFinalDate } from "../../../../utils/interestUtils";
import { applyPaymentToBill } from "@/lib/billing/allocationService";
import Member from "@/models/Member";
import Bill from "@/models/Bill";
import Society from "@/models/Society";
import Transaction from "@/models/Transaction";
import {
  recordPayment,
  PaymentServiceError,
} from "@/lib/services/PaymentService";
import { authorize } from "@/lib/rbac/authorize";
import cache from "@/lib/cache";

// A payment always touches this one member's bill, ledger and receipt list
// at once - invalidate all three v1 keys together so the app never shows
// two of the three updated and one stale.
async function invalidateV1MemberCaches(societyId, memberId) {
  await cache.del(
    `v1:bills:${societyId}:member:${memberId}`,
    `v1:ledger:${societyId}:member:${memberId}`,
    `v1:receipts:${societyId}:member:${memberId}`,
  );
}

// Business logic lives in lib/services/PaymentService.js as of Phase 2.1 of
// the accounting-system revamp (docs/accounting-system-ARD.md §9). This route
// only handles auth + request parsing + response mapping.

export async function POST(request) {
  try {
    const gate = await authorize(request, "finance.payment.record");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    const {
      memberId,
      amount,
      paymentMode,
      paymentDate,
      chequeNo,
      bankName,
      upiId,
      transactionRef,
      notes,
    } = await request.json();
    if (!memberId || !amount) {
      return NextResponse.json(
        { error: "Member ID and amount are required" },
        { status: 400 },
      );
    }
    if (!paymentMode) {
      return NextResponse.json(
        { error: "Payment mode is required" },
        { status: 400 },
      );
    }
    if (amount <= 0) {
      return NextResponse.json(
        { error: "Payment amount must be greater than zero" },
        { status: 400 },
      );
    }
    const member = await Member.findOne({
      _id: memberId,
      societyId: decoded.societyId,
    });
    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    // Guard: reject payment from MEMBER portal if past billPayFinalDay.
    // Admin / Secretary must be able to record late payments.
    const society = await Society.findById(decoded.societyId)
      .select("config")
      .lean();
    const billPayFinalDay = society?.config?.billPayFinalDay || 0;
    if (billPayFinalDay > 0 && decoded.role === "Member") {
      const oldestBill = await Bill.findOne({
        memberId,
        societyId: decoded.societyId,
        status: { $in: ["Unpaid", "Partial", "Overdue"] },
        isDeleted: false,
      })
        .sort({ billYear: 1, billMonth: 1 })
        .lean();
      if (oldestBill) {
        const finalDate = getBillPayFinalDate(
          oldestBill.billYear,
          oldestBill.billMonth + 1, // billMonth is 0-indexed; getBillPayFinalDate expects 1-indexed
          billPayFinalDay,
        );
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (finalDate && today > finalDate) {
          return NextResponse.json(
            {
              error: `Payment not accepted. The payment deadline for bill period ${String(
                oldestBill.billMonth + 1,
              ).padStart(
                2,
                "0",
              )}/${oldestBill.billYear} was ${finalDate.toLocaleDateString(
                "en-IN",
              )}. Please contact the admin to process this payment.`,
            },
            { status: 400 },
          );
        }
      }
    }
    // ✅ Guard: reject payment if today is past billPayFinalDay for the oldest unpaid bill's month
    // const society = await Society.findById(decoded.societyId)
    //   .select("config")
    //   .lean();
    // const billPayFinalDay = society?.config?.billPayFinalDay || 0;
    // if (billPayFinalDay > 0) {
    //   // Find oldest unpaid bill to get its month context
    //   const oldestBill = await Bill.findOne({
    //     memberId,
    //     societyId: decoded.societyId,
    //     status: { $in: ["Unpaid", "Partial", "Overdue"] },
    //     isDeleted: false,
    //   })
    //     .sort({ billYear: 1, billMonth: 1 })
    //     .lean();
    //   if (oldestBill) {
    //     const finalDate = getBillPayFinalDate(
    //       oldestBill.billYear,
    //       oldestBill.billMonth,
    //       billPayFinalDay,
    //     );
    //     const today = new Date();
    //     today.setHours(0, 0, 0, 0);
    //     if (finalDate && today > finalDate) {
    //       return NextResponse.json(
    //         {
    //           error: `Payment not accepted. The payment deadline for bill period ${String(oldestBill.billMonth).padStart(2, "0")}/${oldestBill.billYear} was ${finalDate.toLocaleDateString("en-IN")}. Please contact the admin to process this payment.`,
    //         },
    //         { status: 400 },
    //       );
    //     }
    //   }
    // }
    // Ledger V2 (§14): a member has at most ONE bill carrying a nonzero
    // balance at any time — every generated bill absorbs the previous one's
    // full closing balance into its own opening balance. So we just need the
    // single latest unpaid/partial bill, not a multi-bill scan + allocation.
    const latestUnpaidBill = await Bill.findOne({
      memberId,
      societyId: decoded.societyId,
      status: { $in: ["Unpaid", "Partial", "Overdue"] },
      isDeleted: false,
    })
      .sort({ billYear: -1, billMonth: -1 })
      .select("_id");
    const hasOpeningBalance =
      (member.openingPrincipal || 0) + (member.openingInterest || 0) > 0;
    if (!latestUnpaidBill && !hasOpeningBalance) {
      return NextResponse.json(
        { error: "No outstanding bills found for this member" },
        { status: 400 },
      );
    }
    // Pre-first-bill edge case only: member has an opening-balance seed but
    // has never had a bill generated yet, so there is no Bill row to apply a
    // payment against. This does NOT calculate interest — it's a direct,
    // one-time reduction of the seed values, not a duplicate billing engine.
    if (!latestUnpaidBill && hasOpeningBalance) {
      // Allocate against opening balance using interest-first
      const openingInt = parseFloat((member.openingInterest || 0).toFixed(2));
      const openingPrin = parseFloat((member.openingPrincipal || 0).toFixed(2));
      const paid = parseFloat(amount);
      let intCleared = Math.min(paid, openingInt);
      let remaining = parseFloat((paid - intCleared).toFixed(2));
      let prinCleared = Math.min(remaining, openingPrin);
      let advance = parseFloat((remaining - prinCleared).toFixed(2));
      // Reduce opening balances on Member
      const newOpeningInt = parseFloat((openingInt - intCleared).toFixed(2));
      const newOpeningPrin = parseFloat((openingPrin - prinCleared).toFixed(2));
      await Member.findByIdAndUpdate(memberId, {
        $set: {
          openingInterest: Math.max(0, newOpeningInt),
          openingPrincipal: Math.max(0, newOpeningPrin),
        },
        ...(advance > 0 ? { $inc: { advanceCredit: advance } } : {}),
      });
      // Record ledger transaction
      const lastTxn = await Transaction.findOne({
        memberId,
        societyId: decoded.societyId,
        isReversed: false,
      })
        .sort({ date: -1, createdAt: -1 })
        .lean();
      const prevBal =
        lastTxn?.balanceAfterTransaction ?? member.openingBalance ?? 0;
      const newBal = parseFloat((prevBal - paid).toFixed(2));
      const txn = await Transaction.create({
        transactionId: Transaction.generateTransactionId(),
        date: paymentDate ? new Date(paymentDate) : new Date(),
        memberId,
        societyId: decoded.societyId,
        type: "Credit",
        category: "Payment",
        description: `Payment received (opening balance) via ${paymentMode || "Cash"}${notes ? ` - ${notes}` : ""}`,
        amount: paid,
        balanceAfterTransaction: newBal,
        paymentMode: paymentMode || "Cash",
        chequeNo,
        bankName,
        upiId,
        transactionRef,
        notes,
        createdBy: decoded.userId,
        financialYear: getFinancialYear(new Date()),
        paymentBreakdown: {
          interestCleared: intCleared,
          principalCleared: prinCleared,
          advanceCredit: advance,
        },
      });
      const breakdown = {
        interestCleared: intCleared,
        principalCleared: prinCleared,
        advanceCredit: advance,
      };
      await invalidateV1MemberCaches(decoded.societyId, memberId);
      return NextResponse.json(
        {
          success: true,
          message: "Payment recorded successfully against opening balance",
          transaction: {
            transactionId: txn.transactionId,
            amount: paid,
            previousBalance: prevBal,
            newBalance: newBal,
            breakdown,
            advanceCredit: advance > 0 ? advance : undefined,
          },
        },
        { status: 201 },
      );
    }
    // Ledger V2: all allocation math, invariant checks, and the audit event
    // live inside applyPaymentToBill() — nothing computed independently here.
    let result;
    try {
      result = await applyPaymentToBill({
        billId: latestUnpaidBill._id,
        payment: parseFloat(amount),
        performedBy: decoded.userId,
      });
    } catch (err) {
      if (err.code === "NEGATIVE_PAYMENT")
        return NextResponse.json({ error: err.message }, { status: 400 });
      if (err.code && /^[BP]\d/.test(err.code))
        return NextResponse.json({ error: `Invariant ${err.code}: ${err.message}` }, { status: 422 });
      throw err;
    }
    if (result.skipped) {
      return NextResponse.json(
        { error: `Payment not applied (${result.skipped})` },
        { status: 409 },
      );
    }
    const advanceCredit = result.advanceCredit;
    const breakdown = {
      interestCleared: result.interestPaid,
      principalCleared: result.principalPaid,
      advanceCredit: result.advanceCredit,
    };
    const billsUpdated = [
      {
        billId: result.billId,
        interestCleared: result.interestPaid,
        principalCleared: result.principalPaid,
        newStatus: result.status,
      },
    ];
    // ✅ Get current ledger balance for transaction
    const lastTransaction = await Transaction.findOne({
      memberId,
      societyId: decoded.societyId,
      isReversed: false,
    })
      .sort({ date: -1, createdAt: -1 })
      .lean();
    let currentLedgerBalance =
      lastTransaction?.balanceAfterTransaction ?? member.openingBalance ?? 0;
    const paymentAmount = parseFloat(amount);
    const newLedgerBalance = currentLedgerBalance - paymentAmount;
    // ✅ RECORD PAYMENT TRANSACTION
    const transaction = await Transaction.create({
      transactionId: Transaction.generateTransactionId(),
      date: paymentDate ? new Date(paymentDate) : new Date(),
      memberId,
      societyId: decoded.societyId,
      type: "Credit",
      category: "Payment",
      description: `Payment received via ${paymentMode || "Cash"}${notes ? ` - ${notes}` : ""}`,
      amount: paymentAmount,
      balanceAfterTransaction: newLedgerBalance,
      paymentMode: paymentMode || "Cash",
      chequeNo,
      bankName,
      upiId,
      transactionRef,
      notes,
      createdBy: decoded.userId,
      financialYear: getFinancialYear(new Date()),
    });
    const paymentRecord = await recordPayment({
      memberId,
      societyId: decoded.societyId,
      amount,
      paymentMode,
      paymentDate,
      chequeNo,
      bankName,
      upiId,
      transactionRef,
      notes,
      actorUserId: decoded.userId,
      actorRole: decoded.role,
    });

    await invalidateV1MemberCaches(decoded.societyId, memberId);
    return NextResponse.json(paymentRecord, { status: 201 });
  } catch (error) {
    if (error instanceof PaymentServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Record payment error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
      },
      { status: 500 },
    );
  }
}

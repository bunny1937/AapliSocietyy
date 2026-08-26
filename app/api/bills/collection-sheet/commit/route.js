// app/api/bills/collection-sheet/commit/route.js
//
// The only route in this feature that writes.
//
// It re-runs every check the verify route ran. Verify is a convenience for the
// UI; it is NOT a permission grant. A client could skip verify entirely and
// POST here directly, so the validation has to be duplicated. That duplication
// is deliberate.
//
// Idempotency: the client sends a `commitToken` it generated when the grid was
// opened. A unique index on (societyId, commitToken) means a double-click, a
// retry after a timeout, or a stuck cron cannot post the same collections
// twice.

import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import { authorize } from "@/lib/rbac/authorize";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import Transaction from "@/models/Transaction";
import ScheduledBillRun from "@/models/ScheduledBillRun";
import { getSocietySnapshot, invalidateSocietySnapshot } from "@/lib/import/societySnapshot";
import { verifyRow, configFingerprint, money } from "@/lib/billing/ledgerSignature";
import { applyAllocationToBill } from "@/lib/billing/paymentApplication";
import { allocatePaymentInterestFirst } from "@/utils/interestUtils";
import { notifyPaymentReceived } from "@/lib/v1/notify";
import cache from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const VALID_MODES = ["Cash", "Cheque", "NEFT", "IMPS", "UPI", "Card", "Online"];
const TOLERANCE = 0.01;

export async function POST(request) {
  try {
    const gate = await authorize(request, "billing.bill.generate");
    if (!gate.ok) return gate.response;
    const societyId = gate.context.societyId;
    const userId = gate.context.userId;

    const body = await request.json();
    const {
      periodId,
      fingerprint,
      rows,
      commitToken,
      mode: flowMode,
      scheduleFor,
      nextPeriodId,
      billSeries = "RESIDENTIAL",
    } = body || {};

    if (!commitToken) {
      return NextResponse.json(
        { error: "commitToken is required", code: "NO_TOKEN" },
        { status: 400 },
      );
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "No rows submitted" }, { status: 400 });
    }

    await connectDB();

    // ---- Idempotency gate ------------------------------------------------
    const existing = await Transaction.findOne({ societyId, commitToken })
      .select("_id createdAt")
      .lean();
    if (existing) {
      return NextResponse.json({
        success: true,
        alreadyCommitted: true,
        committedAt: existing.createdAt,
        message: "These collections were already posted.",
      });
    }

    const snapshot = await getSocietySnapshot(societyId);
    const currentFingerprint = configFingerprint({
      config: snapshot.config,
      heads: snapshot.heads,
    });
    if (fingerprint && fingerprint !== currentFingerprint) {
      return NextResponse.json(
        {
          error: "Billing configuration changed. Reload the sheet and verify again.",
          code: "STALE_FINGERPRINT",
          action: "REFETCH",
        },
        { status: 409 },
      );
    }

    // Only rows that actually record money need writing. Rows the admin left
    // blank are declarations of "unpaid", which require no write at all --
    // the balance already carries forward by itself.
    const paying = rows.filter(
      (r) => String(r.mode || "").trim() && Number(r.amountPaid) > 0,
    );
    if (paying.length === 0) {
      return NextResponse.json({
        success: true,
        recorded: 0,
        message: "No collections to post. All flats were marked unpaid.",
      });
    }

    const billIds = paying.map((r) => String(r.billId));
    // Mongoose docs, not .lean() — applyAllocationToBill() mutates these in
    // place and each is saved individually below, the same pattern
    // PaymentService uses. Needs the balance fields too, not just the
    // read-only ones the old $inc-only version used.
    const bills = await Bill.find({ societyId, _id: { $in: billIds } }).select(
      "memberId billPeriodId billSeries totalBillDue amountPaid status openingPrincipal openingInterest currentCharges billPrincipal principalBalance interestBalance balanceAmount",
    );
    const billMap = new Map(bills.map((b) => [String(b._id), b]));

    const payAgg = await Transaction.aggregate([
      {
        $match: {
          societyId,
          billId: { $in: bills.map((b) => b._id) },
          // Old collection-sheet commits wrote type:"PAYMENT"; the canonical
          // shape everywhere else is type:"Credit"/category:"Payment" — match
          // both so a mixed history of old and new rows still sums correctly.
          $or: [
            { type: { $in: ["PAYMENT", "Payment", "payment"] } },
            { type: "Credit", category: "Payment" },
          ],
          isReversed: { $ne: true },
        },
      },
      { $group: { _id: "$billId", paid: { $sum: "$amount" } } },
    ]);
    const paidMap = new Map(payAgg.map((p) => [String(p._id), p.paid]));

    // ---- Re-validate, then build the writes ------------------------------
    const rejected = [];
    const txDocs = [];
    const billsToSave = [];
    const memberAdvanceOps = [];
    const now = new Date();

    // Running ledger balance per member — seeded from each payer's last
    // transaction, so the txn this route writes carries a real
    // balanceAfterTransaction like every other payment path does, instead of
    // leaving it undefined (which is why these rows looked broken/missing in
    // the member ledger — no running balance to render).
    const payerMemberIds = [
      ...new Set(paying.map((r) => String(billMap.get(String(r.billId))?.memberId || ""))),
    ].filter(Boolean);
    const lastTxns = await Transaction.find({
      societyId,
      memberId: { $in: payerMemberIds },
      isReversed: { $ne: true },
    })
      .sort({ date: -1, createdAt: -1 })
      .lean();
    const runningBalance = new Map();
    for (const t of lastTxns) {
      const key = String(t.memberId);
      if (!runningBalance.has(key)) runningBalance.set(key, t.balanceAfterTransaction ?? 0);
    }

    for (const input of paying) {
      const billId = String(input.billId);
      const bill = billMap.get(billId);
      if (!bill) {
        rejected.push({ billId, code: "BILL_NOT_FOUND" });
        continue;
      }
      if (billSeries && bill.billSeries !== billSeries) {
        rejected.push({ billId, code: "WRONG_SERIES" });
        continue;
      }

      const alreadyPaid = money(paidMap.get(billId) ?? bill.amountPaid ?? 0);
      const billDue = money(bill.totalBillDue);
      const remainingDue = money(Math.max(0, billDue - alreadyPaid));
      const openingDue = money(
        (bill.openingPrincipal || 0) + (bill.openingInterest || 0),
      );
      const currentCharges = money(
        bill.currentCharges != null
          ? bill.currentCharges
          : (bill.billPrincipal || 0) - (bill.openingPrincipal || 0),
      );
      let systemStatus = "UNPAID";
      if (alreadyPaid >= billDue && billDue > 0) systemStatus = "PAID";
      else if (alreadyPaid > 0) systemStatus = "PARTIAL";

      const ledger = {
        billId,
        memberId: String(bill.memberId),
        periodId: bill.billPeriodId,
        openingDue,
        currentCharges,
        billDue,
        remainingDue,
        alreadyPaid,
        systemStatus,
      };

      if (!verifyRow(ledger, currentFingerprint, input.sig)) {
        rejected.push({ billId, code: "TAMPERED" });
        continue;
      }

      const enteredAmount = money(input.amountPaid);
      const payMode = String(input.mode).trim();

      if (!VALID_MODES.includes(payMode)) {
        rejected.push({ billId, code: "MODE_INVALID" });
        continue;
      }
      if (systemStatus === "PAID") {
        rejected.push({ billId, code: "ALREADY_SETTLED" });
        continue;
      }
      if (enteredAmount <= 0) {
        rejected.push({ billId, code: "AMOUNT_OUT_OF_BOUNDS", maxAllowed: remainingDue });
        continue;
      }
      // An amount above what's outstanding is only accepted with the admin's
      // explicit per-row confirmation (input.overpayAsAdvance) — verify/route
      // already required this before the client got this far. The bill only
      // ever absorbs remainingDue; the rest becomes advance credit below.
      const overpayExcess = money(Math.max(0, enteredAmount - remainingDue));
      if (overpayExcess > TOLERANCE && !input.overpayAsAdvance) {
        rejected.push({ billId, code: "OVERPAY_NEEDS_CONFIRM", maxAllowed: remainingDue });
        continue;
      }
      const amount = money(enteredAmount - overpayExcess);

      // Canonical interest-first allocation, same helper PaymentService uses —
      // this is what the old version skipped, leaving balanceAmount/
      // principalBalance/interestBalance untouched while amountPaid quietly
      // moved, so the bill looked "Partial" forever and next month's
      // generation carried forward the full pre-payment arrears.
      const { billUpdates } = allocatePaymentInterestFirst(amount, [bill], "INTEREST_FIRST");
      applyAllocationToBill(bill, billUpdates[0], { actorUserId: userId });
      billsToSave.push(bill);

      const memberKey = String(bill.memberId);
      const prevBalance = runningBalance.get(memberKey) ?? 0;
      const newBalance = money(prevBalance - amount);
      runningBalance.set(memberKey, newBalance);

      txDocs.push({
        societyId,
        memberId: bill.memberId,
        billId: new mongoose.Types.ObjectId(billId),
        // Canonical shape (type/category) so this row renders in every ledger
        // view the same as any other payment; source/mode/commitToken kept
        // for this route's own idempotency + provenance.
        type: "Credit",
        category: "Payment",
        source: "ADMIN_COLLECTION",
        amount,
        balanceAfterTransaction: newBalance,
        paymentMode: payMode,
        mode: payMode,
        description: `Payment received via ${payMode} (collection sheet)`,
        remarks: String(input.remarks || "").slice(0, 240),
        date: now,
        recordedBy: userId,
        createdBy: userId,
        commitToken,
        billPeriodId: bill.billPeriodId,
        ...(overpayExcess > 0 ? { advanceCreditAdded: overpayExcess } : {}),
      });

      if (overpayExcess > 0) {
        memberAdvanceOps.push({
          updateOne: {
            filter: { _id: bill.memberId, societyId },
            update: { $inc: { advanceCredit: overpayExcess } },
          },
        });
      }
    }

    if (rejected.length > 0) {
      // All or nothing. Half-posting a collection register is worse than
      // refusing it, because the admin has no way to tell which half landed.
      return NextResponse.json(
        {
          error: "Some rows failed re-validation at commit time. Nothing was posted.",
          code: "COMMIT_REJECTED",
          rejected,
        },
        { status: 409 },
      );
    }

    const insertedTxns = await Transaction.insertMany(txDocs, { ordered: false });
    await Promise.all(billsToSave.map((b) => b.save()));
    if (memberAdvanceOps.length) await Member.bulkWrite(memberAdvanceOps, { ordered: false });

    // Close the WHOLE period, not just the bills that got paid this round.
    // A flat marked "unpaid" on the collection sheet was still processed —
    // its balance simply carries forward as a normal debt from here, same
    // as a paid one, it just doesn't stay pinned to the app's home screen
    // as this period's own urgent bill once the admin has moved on.
    await Bill.updateMany(
      { societyId, billPeriodId: periodId, billSeries, isDeleted: { $ne: true } },
      { $set: { periodClosed: true } },
    );

    // Nobody was ever told their payment landed via this route — the same
    // gap fixed on the single-payment /api/payments/record path.
    await Promise.all(
      insertedTxns.map((t) =>
        notifyPaymentReceived({
          transactionId: t._id,
          societyId,
          memberId: t.memberId,
          amount: t.amount,
          period: t.billPeriodId,
        }).catch((e) => console.error("notifyPaymentReceived failed:", e.message)),
      ),
    );

    // ---- Optional: schedule next month -----------------------------------
    let scheduled = null;
    if (flowMode === "schedule" && scheduleFor && nextPeriodId) {
      const runAt = new Date(`${scheduleFor}T02:00:00.000Z`);
      if (!Number.isNaN(runAt.getTime())) {
        await ScheduledBillRun.findOneAndUpdate(
          { societyId, periodId: nextPeriodId, billSeries },
          {
            $set: {
              societyId,
              periodId: nextPeriodId,
              billSeries,
              runAt,
              status: "SCHEDULED",
              createdBy: userId,
            },
          },
          { upsert: true, new: true },
        );
        scheduled = runAt;
      }
    }

    // Invalidate everything this touched.
    await Promise.all([
      cache.del(`billing:generated:${societyId}`),
      cache.del(`payments:outstanding:${societyId}`),
      cache.delPattern(`collection:sheet:${societyId}:${billSeries}:${periodId}:*`),
      invalidateSocietySnapshot(societyId),
      // Every member on this collection sheet just had a payment posted.
      cache.delPattern(`v1:bills:${societyId}:member:*`),
      cache.delPattern(`v1:ledger:${societyId}:member:*`),
    ]);

    return NextResponse.json({
      success: true,
      recorded: txDocs.length,
      totalAmount: money(txDocs.reduce((s, t) => s + t.amount, 0)),
      totalAdvanceCredit: money(txDocs.reduce((s, t) => s + (t.advanceCreditAdded || 0), 0)),
      scheduled,
      periodId,
    });
  } catch (error) {
    console.error("collection-sheet/commit error:", error);
    return NextResponse.json(
      { error: "Commit failed" },
      { status: 500 },
    );
  }
}

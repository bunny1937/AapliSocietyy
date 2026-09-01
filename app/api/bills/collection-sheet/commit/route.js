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
import Receipt from "@/models/Receipt";
import ScheduledBillRun from "@/models/ScheduledBillRun";
import { getSocietySnapshot, invalidateSocietySnapshot } from "@/lib/import/societySnapshot";
import { verifyRow, configFingerprint, money } from "@/lib/billing/ledgerSignature";
import { applyAllocationToBill } from "@/lib/billing/paymentApplication";
import { allocatePaymentInterestFirst } from "@/utils/interestUtils";
import { issueReceiptNo } from "@/lib/billing/receiptIssuance";
import { notifyPaymentReceived } from "@/lib/v1/notify";
import { postPaymentToLedger } from "@/lib/accounting/paymentLedgerPosting";
import cache from "@/lib/cache";

/** Same convention app/api/billing/upload-payments/route.js already uses for its Receipt.filename. */
function receiptFilename(member, billPeriodId) {
  const nameParts = (member?.ownerName || "member").trim().split(/\s+/);
  const nameSlug = nameParts.length > 1 ? `${nameParts[0]}_${nameParts[nameParts.length - 1]}` : nameParts[0];
  const flatSlug = `${member?.wing || ""}-${member?.flatNo || ""}`;
  return `${nameSlug}_${flatSlug}_${billPeriodId}_receipt`.replace(/[^a-zA-Z0-9_\-]/g, "_");
}

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
    const receiptDocs = [];
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
    // For Receipt.filename — the only reason this route needs Member docs at all.
    const payerMembers = await Member.find({ _id: { $in: payerMemberIds } })
      .select("ownerName wing flatNo")
      .lean();
    const memberByIdMap = new Map(payerMembers.map((m) => [String(m._id), m]));

    // Any amount above what settles the row's own bill used to become
    // undifferentiated advanceCredit even when the same member had other
    // bills sitting Unpaid/Partial — so an admin could overpay one bill by
    // hundreds while an older bill of the same member stayed "Partial"
    // forever, and the overpay landed nowhere visible ("applied to what?").
    // Overpay now walks that member's other open bills oldest-first —
    // interest across all of them first, then principal across all of them,
    // same INTEREST_FIRST convention as the primary bill — before any
    // remainder becomes advance credit.
    const excludeBillIds = paying.map((r) => String(r.billId));
    const otherOpenBillsRaw = await Bill.find({
      societyId,
      billSeries,
      memberId: { $in: payerMemberIds },
      status: { $in: ["Unpaid", "Partial"] },
      isDeleted: { $ne: true },
      _id: { $nin: excludeBillIds },
    })
      .select(
        "memberId billPeriodId billSeries totalBillDue amountPaid status openingPrincipal openingInterest currentCharges billPrincipal principalBalance interestBalance balanceAmount",
      )
      .sort({ billPeriodId: 1 });
    const otherOpenBillsByMember = new Map();
    for (const b of otherOpenBillsRaw) {
      const key = String(b.memberId);
      if (!otherOpenBillsByMember.has(key)) otherOpenBillsByMember.set(key, []);
      otherOpenBillsByMember.get(key).push(b);
    }
    const billsToSaveSet = new Set();

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
      const rawOverpay = money(Math.max(0, enteredAmount - remainingDue));
      if (rawOverpay > TOLERANCE && !input.overpayAsAdvance) {
        rejected.push({ billId, code: "OVERPAY_NEEDS_CONFIRM", maxAllowed: remainingDue });
        continue;
      }
      const amount = money(enteredAmount - rawOverpay);

      // Canonical interest-first allocation, same helper PaymentService uses —
      // this is what the old version skipped, leaving balanceAmount/
      // principalBalance/interestBalance untouched while amountPaid quietly
      // moved, so the bill looked "Partial" forever and next month's
      // generation carried forward the full pre-payment arrears.
      const { billUpdates } = allocatePaymentInterestFirst(amount, [bill], "INTEREST_FIRST");
      applyAllocationToBill(bill, billUpdates[0], { actorUserId: userId });
      if (!billsToSaveSet.has(billId)) {
        billsToSave.push(bill);
        billsToSaveSet.add(billId);
      }

      const memberKey = String(bill.memberId);
      const prevBalance = runningBalance.get(memberKey) ?? 0;
      let newBalance = money(prevBalance - amount);
      runningBalance.set(memberKey, newBalance);
      // Overflow (below) keeps mutating newBalance for its own ledger rows —
      // snapshot the primary payment's own post-balance now, so the primary
      // Transaction records the ledger state right after ITS OWN amount,
      // not after overflow rows that logically come after it.
      const primaryBalanceAfter = newBalance;

      // REQUIRED on the Transaction model (unique + required, no default/
      // pre-save hook) — every doc built here was missing it, so
      // Transaction.insertMany(..., {ordered:false}) was silently dropping
      // every single one on client-side validation and resolving with an
      // EMPTY array, no error thrown. The route never checked
      // insertedTxns.length against txDocs.length, so it kept reporting
      // "recorded: N" while zero rows ever reached the database — no ledger
      // entry, no receipt, no payment history, for any society, since this
      // route was written.
      const transactionId = Transaction.generateTransactionId();

      // Pushed BEFORE the overflow block below so this member's own-bill
      // payment lands in the ledger ahead of any overflow rows it funds —
      // overflow logically happens with what's left AFTER this payment.
      // Kept as a reference (not just pushed) so the overflow pass below can
      // patch in the real advanceCreditAdded once it knows what's left.
      const primaryTxDoc = {
        transactionId,
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
        balanceAfterTransaction: primaryBalanceAfter,
        paymentMode: payMode,
        mode: payMode,
        description: `Payment received via ${payMode} (collection sheet)`,
        remarks: String(input.remarks || "").slice(0, 240),
        date: now,
        recordedBy: userId,
        createdBy: userId,
        commitToken,
        billPeriodId: bill.billPeriodId,
      };
      txDocs.push(primaryTxDoc);

      // This route never created a Receipt at all — the other two working
      // payment paths (billing/upload-payments, v1/bills/[id]/pay) both do.
      // A payment recorded from the collection sheet had no receipt to show
      // or download, in the app or the member portal, ever.
      const receiptMember = memberByIdMap.get(memberKey);
      const primaryReceiptDoc = {
        receiptNo: await issueReceiptNo(bill),
        filename: receiptFilename(receiptMember, bill.billPeriodId),
        billId: bill._id,
        billPeriodId: bill.billPeriodId,
        memberId: bill.memberId,
        societyId,
        billSeries: bill.billSeries,
        amount,
        amountReceived: enteredAmount,
        amountApplied: amount,
        interestApplied: billUpdates[0]?.interestCleared || 0,
        principalApplied: billUpdates[0]?.principalCleared || 0,
        remainingBalance: bill.balanceAmount,
        settlementStatus: bill.balanceAmount > 0 ? "Partial" : "Paid",
        previousBalanceSnapshot: openingDue,
        paymentMode: payMode,
        paidAt: now,
        transactionId,
        status: "Generated",
      };
      receiptDocs.push(primaryReceiptDoc);

      // ---- Overpay walks the member's OTHER open bills before advance ----
      let overpayExcess = rawOverpay;
      if (rawOverpay > TOLERANCE) {
        const otherBills = (otherOpenBillsByMember.get(memberKey) || []).filter(
          (b) => b.balanceAmount > TOLERANCE,
        );
        if (otherBills.length > 0) {
          const overflow = allocatePaymentInterestFirst(rawOverpay, otherBills, "INTEREST_FIRST");
          for (const update of overflow.billUpdates) {
            const otherBill = otherBills.find((b) => String(b._id) === String(update.billId));
            const cleared = money(Number(update.interestCleared) + Number(update.principalCleared));
            if (!otherBill || cleared <= 0) continue;
            applyAllocationToBill(otherBill, update, { actorUserId: userId });
            const otherKey = String(otherBill._id);
            if (!billsToSaveSet.has(otherKey)) {
              billsToSave.push(otherBill);
              billsToSaveSet.add(otherKey);
            }

            newBalance = money(newBalance - cleared);
            runningBalance.set(memberKey, newBalance);

            const overflowTxnId = Transaction.generateTransactionId();
            txDocs.push({
              transactionId: overflowTxnId,
              societyId,
              memberId: otherBill.memberId,
              billId: otherBill._id,
              type: "Credit",
              category: "Payment",
              source: "ADMIN_COLLECTION",
              amount: cleared,
              balanceAfterTransaction: newBalance,
              paymentMode: payMode,
              mode: payMode,
              description: `Overpayment from ${bill.billPeriodId} applied to ${otherBill.billPeriodId} arrears (${payMode})`,
              remarks: String(input.remarks || "").slice(0, 240),
              date: now,
              recordedBy: userId,
              createdBy: userId,
              commitToken,
              billPeriodId: otherBill.billPeriodId,
            });
            receiptDocs.push({
              receiptNo: await issueReceiptNo(otherBill),
              filename: receiptFilename(memberByIdMap.get(memberKey), otherBill.billPeriodId),
              billId: otherBill._id,
              billPeriodId: otherBill.billPeriodId,
              memberId: otherBill.memberId,
              societyId,
              billSeries: otherBill.billSeries,
              amount: cleared,
              amountReceived: cleared,
              amountApplied: cleared,
              interestApplied: Number(update.interestCleared) || 0,
              principalApplied: Number(update.principalCleared) || 0,
              advanceCreditCreated: 0,
              remainingBalance: otherBill.balanceAmount,
              settlementStatus: otherBill.balanceAmount > 0 ? "Partial" : "Paid",
              previousBalanceSnapshot: money(
                (otherBill.openingPrincipal || 0) + (otherBill.openingInterest || 0),
              ),
              paymentMode: payMode,
              paidAt: now,
              transactionId: overflowTxnId,
              status: "Generated",
            });
          }
          // Whatever the overflow pass couldn't place (every other open bill
          // now Paid) is the only part that's genuinely an advance.
          overpayExcess = overflow.advanceCredit;
        }
      }

      // Backfill the primary tx/receipt with whatever's left as real advance
      // credit AFTER the overflow pass above ran — only overpay that no open
      // bill could absorb counts as advanceCredit now.
      if (overpayExcess > 0) primaryTxDoc.advanceCreditAdded = overpayExcess;
      primaryReceiptDoc.advanceCreditCreated = overpayExcess;

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
    // insertMany with ordered:false does NOT throw when a document fails
    // schema validation — it silently drops that document and resolves with
    // whatever did pass. A missing required field (transactionId was the
    // real case) used to fail every doc this way with zero error surfaced.
    // Never again report success while writing fewer ledger rows than bills
    // it just changed the balance of.
    if (insertedTxns.length !== txDocs.length) {
      console.error(
        `collection-sheet/commit: insertMany wrote ${insertedTxns.length}/${txDocs.length} transactions — refusing to save bill changes against a short ledger.`,
      );
      return NextResponse.json(
        {
          error: "Could not record the payment ledger entries. Nothing was posted — try again.",
          code: "LEDGER_WRITE_INCOMPLETE",
        },
        { status: 500 },
      );
    }
    // This route never posted a single one of these payments to the
    // accounting ledger — no Cash/Bank debit, no Member Receivable credit,
    // ever, for any society whose admin uses the collection sheet (the main
    // way payments actually get recorded). Fail-soft per transaction: a
    // ledger-posting failure must not undo a payment that already landed on
    // the bill/Transaction/Receipt side. postPaymentToLedger no-ops
    // (returns null) when the society hasn't turned Accounting on, so this
    // is silent-safe for societies that don't use it at all.
    let ledgerFailCount = 0;
    const txDocById = new Map(txDocs.map((d) => [d.transactionId, d]));
    for (const t of insertedTxns) {
      const meta = txDocById.get(t.transactionId);
      try {
        await postPaymentToLedger(societyId, {
          transaction: t,
          paymentMode: t.paymentMode,
          appliedToDues: t.amount,
          advance: meta?.advanceCreditAdded || 0,
          actorUserId: userId,
        });
      } catch (err) {
        ledgerFailCount++;
        console.error(`collection-sheet/commit: postPaymentToLedger failed for ${t.transactionId}:`, err.message);
      }
    }

    // Best-effort: a missing receipt is a real gap, but not one that should
    // undo an already-verified, already-recorded payment the way a short
    // ledger write does above — the money moved either way. "Best-effort"
    // used to mean "log it and the admin never finds out" — a payment could
    // go through with zero receipts and nothing in the response ever said
    // so. Now the gap count travels in the response, and every gap (this
    // commit's or any earlier one's) stays visible and one-click fixable on
    // /admin/receipts (see app/api/admin/receipts/gaps/route.js).
    let receiptGapCount = 0;
    const insertedReceipts = await Receipt.insertMany(receiptDocs, { ordered: false }).catch((e) => {
      console.error("collection-sheet/commit: receipt insert failed:", e.message);
      return [];
    });
    if (insertedReceipts.length !== receiptDocs.length) {
      receiptGapCount = receiptDocs.length - insertedReceipts.length;
      console.error(
        `collection-sheet/commit: wrote ${insertedReceipts.length}/${receiptDocs.length} receipts — ${receiptGapCount} payment(s) recorded with no receipt.`,
      );
    }
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
      ...(receiptGapCount > 0 || ledgerFailCount > 0
        ? {
            warning: [
              receiptGapCount > 0
                ? `${receiptGapCount} receipt(s) could not be generated (fix on the Receipts page).`
                : null,
              ledgerFailCount > 0
                ? `${ledgerFailCount} payment(s) could not be posted to Accounting (fix on the Vouchers page).`
                : null,
            ]
              .filter(Boolean)
              .join(" "),
            receiptGapCount,
            ledgerFailCount,
          }
        : {}),
    });
  } catch (error) {
    console.error("collection-sheet/commit error:", error);
    return NextResponse.json(
      { error: "Commit failed" },
      { status: 500 },
    );
  }
}

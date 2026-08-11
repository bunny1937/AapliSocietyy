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
import Transaction from "@/models/Transaction";
import ScheduledBillRun from "@/models/ScheduledBillRun";
import { getSocietySnapshot, invalidateSocietySnapshot } from "@/lib/import/societySnapshot";
import { verifyRow, configFingerprint, money } from "@/lib/billing/ledgerSignature";
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
    const bills = await Bill.find({ societyId, _id: { $in: billIds } })
      .select(
        "memberId billPeriodId billSeries totalBillDue amountPaid status openingPrincipal openingInterest currentCharges billPrincipal",
      )
      .lean();
    const billMap = new Map(bills.map((b) => [String(b._id), b]));

    const payAgg = await Transaction.aggregate([
      {
        $match: {
          societyId,
          billId: { $in: bills.map((b) => b._id) },
          type: { $in: ["PAYMENT", "Payment", "payment"] },
          isReversed: { $ne: true },
        },
      },
      { $group: { _id: "$billId", paid: { $sum: "$amount" } } },
    ]);
    const paidMap = new Map(payAgg.map((p) => [String(p._id), p.paid]));

    // ---- Re-validate, then build the writes ------------------------------
    const rejected = [];
    const txDocs = [];
    const billOps = [];
    const now = new Date();

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

      const amount = money(input.amountPaid);
      const payMode = String(input.mode).trim();

      if (!VALID_MODES.includes(payMode)) {
        rejected.push({ billId, code: "MODE_INVALID" });
        continue;
      }
      if (systemStatus === "PAID") {
        rejected.push({ billId, code: "ALREADY_SETTLED" });
        continue;
      }
      if (amount <= 0 || amount > remainingDue + TOLERANCE) {
        rejected.push({ billId, code: "AMOUNT_OUT_OF_BOUNDS", maxAllowed: remainingDue });
        continue;
      }

      const totalAfter = money(alreadyPaid + amount);
      const newStatus = totalAfter >= billDue - TOLERANCE ? "Paid" : "Partial";

      txDocs.push({
        societyId,
        memberId: bill.memberId,
        billId: new mongoose.Types.ObjectId(billId),
        type: "PAYMENT",
        source: "ADMIN_COLLECTION",
        amount,
        mode: payMode,
        remarks: String(input.remarks || "").slice(0, 240),
        date: now,
        recordedBy: userId,
        commitToken,
        billPeriodId: bill.billPeriodId,
      });

      billOps.push({
        updateOne: {
          filter: { _id: bill._id, societyId },
          update: {
            $inc: { amountPaid: amount },
            $set: { status: newStatus, lastPaymentAt: now },
          },
        },
      });
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

    await Transaction.insertMany(txDocs, { ordered: false });
    if (billOps.length) await Bill.bulkWrite(billOps, { ordered: false });

    // ---- Optional: schedule next month -----------------------------------
    let scheduled = null;
    if (flowMode === "schedule" && scheduleFor && nextPeriodId) {
      const runAt = new Date(`${scheduleFor}T02:00:00.000Z`);
      if (!Number.isNaN(runAt.getTime())) {
        await ScheduledBillRun.findOneAndUpdate(
          { societyId, periodId: nextPeriodId },
          {
            $set: {
              societyId,
              periodId: nextPeriodId,
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
    ]);

    return NextResponse.json({
      success: true,
      recorded: txDocs.length,
      totalAmount: money(txDocs.reduce((s, t) => s + t.amount, 0)),
      scheduled,
      periodId,
    });
  } catch (error) {
    console.error("collection-sheet/commit error:", error);
    return NextResponse.json(
      { error: "Commit failed", details: error.message },
      { status: 500 },
    );
  }
}

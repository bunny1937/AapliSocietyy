// app/api/admin/receipts/gaps/route.js
//
// The 2026-08-30 bug hunt found the same failure twice, in two different
// payment-recording routes: a Receipt required field got omitted, the write
// failed, and nothing surfaced it — the payment succeeded, the receipt just
// silently never existed, until a member asked for it. "Best-effort, log and
// move on" for a Receipt insert is the wrong default: money moved but no
// paper trail exists for it. This route makes that condition visible and
// fixable instead of silent:
//
//   GET  — list every payment Transaction (type Credit, category Payment,
//          not reversed) in this society that has no matching Receipt.
//   POST — backfill Receipts for the given transactionIds (or every gap, if
//          none given), using the same receiptNo/filename convention as
//          every other payment path.
//
// This does NOT create money or change any Bill/Transaction — it only adds
// the missing paper trail for a payment that already happened.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import mongoose from "mongoose";
import { authorize } from "@/lib/rbac/authorize";
import Transaction from "@/models/Transaction";
import Receipt from "@/models/Receipt";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import { issueReceiptNo } from "@/lib/billing/receiptIssuance";

function receiptFilename(member, billPeriodId) {
  const nameParts = (member?.ownerName || "member").trim().split(/\s+/);
  const nameSlug = nameParts.length > 1 ? `${nameParts[0]}_${nameParts[nameParts.length - 1]}` : nameParts[0];
  const flatSlug = `${member?.wing || ""}-${member?.flatNo || ""}`;
  return `${nameSlug}_${flatSlug}_${billPeriodId}_receipt`.replace(/[^a-zA-Z0-9_\-]/g, "_");
}

async function findGaps(societyId) {
  const paymentTxns = await Transaction.find({
    societyId,
    type: "Credit",
    category: "Payment",
    isReversed: { $ne: true },
  })
    .select("transactionId memberId billId billPeriodId amount date paymentMode")
    .sort({ date: -1 })
    .lean();
  if (paymentTxns.length === 0) return [];

  const existingReceipts = await Receipt.find({
    societyId,
    transactionId: { $in: paymentTxns.map((t) => t.transactionId) },
  })
    .select("transactionId")
    .lean();
  const covered = new Set(existingReceipts.map((r) => r.transactionId));

  return paymentTxns.filter((t) => !covered.has(t.transactionId));
}

export async function GET(request) {
  try {
    const gate = await authorize(request, "finance.receipt.view");
    if (!gate.ok) return gate.response;
    await connectDB();
    const societyId = gate.context.societyId;

    const gaps = await findGaps(societyId);
    const memberIds = [...new Set(gaps.map((g) => String(g.memberId)))];
    const members = await Member.find({ _id: { $in: memberIds } })
      .select("ownerName wing flatNo")
      .lean();
    const memberById = new Map(members.map((m) => [String(m._id), m]));

    return NextResponse.json({
      success: true,
      count: gaps.length,
      gaps: gaps.map((g) => ({
        transactionId: g.transactionId,
        billId: g.billId,
        billPeriodId: g.billPeriodId,
        amount: g.amount,
        date: g.date,
        paymentMode: g.paymentMode,
        member: memberById.get(String(g.memberId)) || null,
      })),
    });
  } catch (err) {
    console.error("receipts/gaps GET error:", err);
    return NextResponse.json({ error: "Could not check for missing receipts" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    // No dedicated "finance.receipt.manage" permission exists yet — this app
    // has no write-permission for receipts distinct from viewing them
    // (lib/rbac/page-access-map.js's "manage" bucket for Receipts reuses the
    // view permissions). Gate on the same permission that creates receipts
    // in the normal flow (collection-sheet/commit) rather than inventing a
    // new catalog entry for what is, functionally, the same capability.
    const gate = await authorize(request, "billing.bill.generate");
    if (!gate.ok) return gate.response;
    await connectDB();
    const societyId = gate.context.societyId;

    const body = await request.json().catch(() => ({}));
    const requestedIds = Array.isArray(body.transactionIds) ? body.transactionIds : null;

    let gaps = await findGaps(societyId);
    if (requestedIds) {
      const wanted = new Set(requestedIds);
      gaps = gaps.filter((g) => wanted.has(g.transactionId));
    }
    if (gaps.length === 0) {
      return NextResponse.json({ success: true, created: 0, message: "No missing receipts found." });
    }

    const billIds = [...new Set(gaps.map((g) => String(g.billId)))].filter(Boolean);
    const bills = await Bill.find({ _id: { $in: billIds } }).lean();
    const billById = new Map(bills.map((b) => [String(b._id), b]));

    const memberIds = [...new Set(gaps.map((g) => String(g.memberId)))];
    const members = await Member.find({ _id: { $in: memberIds } })
      .select("ownerName wing flatNo")
      .lean();
    const memberById = new Map(members.map((m) => [String(m._id), m]));

    const docs = [];
    const skipped = [];
    for (const g of gaps) {
      const bill = billById.get(String(g.billId));
      if (!bill) {
        skipped.push({ transactionId: g.transactionId, reason: "BILL_NOT_FOUND" });
        continue;
      }
      const member = memberById.get(String(g.memberId));
      docs.push({
        receiptNo: await issueReceiptNo(bill),
        filename: receiptFilename(member, g.billPeriodId),
        billId: new mongoose.Types.ObjectId(g.billId),
        billPeriodId: g.billPeriodId,
        memberId: g.memberId,
        societyId,
        billSeries: bill.billSeries,
        amount: g.amount,
        amountReceived: g.amount,
        amountApplied: g.amount,
        remainingBalance: bill.balanceAmount,
        settlementStatus: bill.balanceAmount > 0 ? "Partial" : "Paid",
        paymentMode: g.paymentMode || "Cash",
        paidAt: g.date,
        transactionId: g.transactionId,
        status: "Generated",
        notes: "Backfilled via Receipts → Fix missing receipts (recovered a payment that had none).",
      });
    }

    const inserted = docs.length ? await Receipt.insertMany(docs, { ordered: false }) : [];
    return NextResponse.json({
      success: true,
      created: inserted.length,
      skipped,
    });
  } catch (err) {
    console.error("receipts/gaps POST error:", err);
    return NextResponse.json({ error: "Could not backfill missing receipts" }, { status: 500 });
  }
}

// app/api/admin/accounting/ledger-gaps/route.js
//
// 2026-08-30: found TWO of the four payment-recording routes
// (collection-sheet/commit, billing/upload-payments) never called
// postPaymentToLedger at all — every payment recorded through either one
// updated the Bill/Transaction/Receipt but never touched Accounting: no
// Cash/Bank debit, no Member Receivable credit. Both now call it (fail-soft,
// so a ledger issue can't undo an already-recorded payment), but that still
// leaves a real question for the moment it fails, or for every payment
// recorded before today's fix. This route answers it instead of leaving it
// silent:
//
//   GET  — list every payment Transaction in this society, for a society
//          that has Accounting turned on, with no matching Voucher posted.
//   POST — backfill ledger postings for the given transactionIds (or every
//          gap, if none given), via the same postPaymentToLedger() every
//          live payment route uses.
//
// This does NOT touch Bill/Transaction/Receipt or any money figure — it only
// posts the missing Journal Entry for a payment that already happened.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { authorize } from "@/lib/rbac/authorize";
import Transaction from "@/models/Transaction";
import Voucher from "@/models/Voucher";
import Member from "@/models/Member";
import { getFiscalConfig } from "@/lib/services/FiscalConfigService";
import { postPaymentToLedger } from "@/lib/accounting/paymentLedgerPosting";

async function findGaps(societyId) {
  const config = await getFiscalConfig(societyId);
  if (!config.enabled) return { enabled: false, gaps: [] };

  const paymentTxns = await Transaction.find({
    societyId,
    type: "Credit",
    category: { $in: ["Payment", "Maintenance"] },
    isReversed: { $ne: true },
  })
    .select("memberId amount paymentMode date paymentBreakdown advanceCreditAdded")
    .sort({ date: -1 })
    .lean();
  if (paymentTxns.length === 0) return { enabled: true, gaps: [] };

  const postedVouchers = await Voucher.find({
    societyId,
    idempotencyKey: { $in: paymentTxns.map((t) => `payment:${t._id}`) },
    status: { $in: ["Posted", "Reversed"] },
    isDeleted: false,
  })
    .select("idempotencyKey")
    .lean();
  const posted = new Set(postedVouchers.map((v) => v.idempotencyKey));

  const gaps = paymentTxns.filter((t) => !posted.has(`payment:${t._id}`));
  return { enabled: true, gaps };
}

export async function GET(request) {
  try {
    const gate = await authorize(request, "accounting.vouchers.view");
    if (!gate.ok) return gate.response;
    await connectDB();
    const societyId = gate.context.societyId;

    const { enabled, gaps } = await findGaps(societyId);
    if (!enabled) {
      return NextResponse.json({ success: true, accountingEnabled: false, count: 0, gaps: [] });
    }

    const memberIds = [...new Set(gaps.map((g) => String(g.memberId)))];
    const members = await Member.find({ _id: { $in: memberIds } })
      .select("ownerName wing flatNo")
      .lean();
    const memberById = new Map(members.map((m) => [String(m._id), m]));

    return NextResponse.json({
      success: true,
      accountingEnabled: true,
      count: gaps.length,
      gaps: gaps.map((g) => ({
        transactionId: String(g._id),
        amount: g.amount,
        date: g.date,
        paymentMode: g.paymentMode,
        member: memberById.get(String(g.memberId)) || null,
      })),
    });
  } catch (err) {
    console.error("accounting/ledger-gaps GET error:", err);
    return NextResponse.json({ error: "Could not check for missing ledger postings" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    // Same reasoning as app/api/admin/receipts/gaps: no dedicated
    // "accounting.ledger.manage" permission exists — this is functionally
    // the same write every live payment route already makes, so it's gated
    // on the same permission that records payments in the normal flow.
    const gate = await authorize(request, "billing.bill.generate");
    if (!gate.ok) return gate.response;
    await connectDB();
    const societyId = gate.context.societyId;

    const body = await request.json().catch(() => ({}));
    const requestedIds = Array.isArray(body.transactionIds) ? body.transactionIds : null;

    const { enabled, gaps } = await findGaps(societyId);
    if (!enabled) {
      return NextResponse.json({ success: true, posted: 0, message: "Accounting is not enabled for this society." });
    }
    let targets = gaps;
    if (requestedIds) {
      const wanted = new Set(requestedIds);
      targets = targets.filter((g) => wanted.has(String(g._id)));
    }
    if (targets.length === 0) {
      return NextResponse.json({ success: true, posted: 0, message: "No missing ledger postings found." });
    }

    let posted = 0;
    const failed = [];
    for (const t of targets) {
      try {
        await postPaymentToLedger(societyId, {
          transaction: t,
          paymentMode: t.paymentMode,
          appliedToDues: t.amount - (t.advanceCreditAdded || 0),
          advance: t.advanceCreditAdded || 0,
          actorUserId: gate.context.userId,
        });
        posted++;
      } catch (err) {
        failed.push({ transactionId: String(t._id), reason: err.message });
      }
    }

    return NextResponse.json({ success: true, posted, failed });
  } catch (err) {
    console.error("accounting/ledger-gaps POST error:", err);
    return NextResponse.json({ error: "Could not backfill missing ledger postings" }, { status: 500 });
  }
}

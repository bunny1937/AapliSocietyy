// app/api/bills/preview-residential/route.js
//
// Server-computed preview for RESIDENTIAL bills — the counterpart to
// /api/commercial/preview-bills. Before this route, the residential wizard
// computed its preview client-side (computeBillTotal() in
// BillGenerationFlow.jsx), a second copy of the billing math kept in sync by
// hand with the real engine (lib/billing/generationService.js). Commercial
// was already fixed to run the real engine as a dry run instead, on exactly
// this argument: "the numbers on screen can never diverge from what
// generation writes." This gives residential the same guarantee — same
// contract (`{memberIds, billYear, billMonth}` -> `{previews, skipped}`),
// so segments.js just flips residential's previewMode to "server" and the
// existing reconciliation code in BillGenerationFlow.jsx (already
// field-agnostic — see its own comment) needs no changes at all.
//
// Read-only: computeBill()/resolveOpeningBalances() are the same pure,
// non-writing functions lib/billing/billPreview.js already uses for the
// ?dryRun=1 half of /api/bills/generate-final.

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import Member from "@/models/Member";
import BillingHead from "@/models/BillingHead";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { authorize } from "@/lib/rbac/authorize";
import { computeBill, resolveOpeningBalances } from "@/lib/billing/generationService";

const flatLabel = (m) => [m.wing, m.flatNo].filter(Boolean).join("-") || String(m.flatNo || "?");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const gate = await authorize(request, "billing.bill.generate");
    if (!gate.ok) return gate.response;

    const body = await request.json();
    const ids = Array.isArray(body.memberIds) ? body.memberIds : [];
    const { billYear, billMonth } = body;

    if (!ids.length) {
      return NextResponse.json(
        { error: "Select at least one flat to preview.", code: "NO_MEMBERS" },
        { status: 400 },
      );
    }
    if (!billYear || !billMonth) {
      return NextResponse.json(
        { error: "Choose the bill month before previewing.", code: "NO_PERIOD" },
        { status: 400 },
      );
    }

    const societyId = decoded.societyId;
    const currentPeriodId = `${billYear}-${String(billMonth).padStart(2, "0")}`;

    const [members, society, heads] = await Promise.all([
      Member.find({ _id: { $in: ids }, societyId, isDeleted: { $ne: true } }).lean(),
      Society.findById(societyId).lean(),
      BillingHead.find({ societyId, isActive: true, isDeleted: false }).sort({ order: 1 }).lean(),
    ]);

    const skipped = [];
    const previews = {};

    for (const member of members) {
      const memberId = String(member._id);
      const label = flatLabel(member);
      let computed;
      let openingPrincipal = 0;
      let openingInterest = 0;

      try {
        ({ openingPrincipal, openingInterest } = await resolveOpeningBalances({
          memberId, societyId, year: Number(billYear), month: Number(billMonth), member,
        }));
        computed = computeBill({
          member, heads, society, year: Number(billYear), month: Number(billMonth),
          openingPrincipal, openingInterest,
        });
      } catch (err) {
        // One misconfigured flat must never blank the whole preview — same
        // policy as the commercial preview route.
        skipped.push({
          memberId, flat: label, memberName: member.ownerName || "Unknown",
          code: err?.code || "CALC_FAILED",
          reason: err?.message || "This unit's bill could not be worked out.",
        });
        continue;
      }

      const [unpaidBills, recentTransactions] = await Promise.all([
        Bill.find({
          societyId, memberId,
          status: { $in: ["Unpaid", "Partial", "Overdue"] },
          billPeriodId: { $ne: currentPeriodId },
          isDeleted: { $ne: true },
        })
          .sort({ billYear: 1, billMonth: 1 })
          .select("billPeriodId totalAmount balanceAmount dueDate status billNo")
          .lean(),
        Transaction.find({ societyId, memberId })
          .sort({ date: -1 })
          .limit(10)
          .select("date type category description amount balanceAfterTransaction billPeriodId")
          .lean(),
      ]);

      previews[memberId] = {
        memberId,
        flat: label,
        memberName: member.ownerName || "Unknown",
        area: Number(member.carpetAreaSqft ?? member.builtUpAreaSqft ?? member.areaSqFt ?? 0) || 0,
        charges: Object.entries(computed.charges).map(([name, amount]) => ({ name, amount })),
        notCharged: (computed.skipped ?? []).map((sk) => ({
          name: sk.headName, code: sk.code || sk.reason, reason: sk.message || "Left off this bill.",
        })),
        openingPrincipal,
        openingInterest,
        currentCharges: computed.currentCharges,
        currentInterest: computed.currentInterest,
        interestRateApplied: computed.interestRateApplied,
        totalBillDue: computed.totalBillDue,
        unpaidBills,
        recentTransactions,
        // Residential-only fields BillGenerationFlow's reconciliation reads
        // that a generic computeBill() has no concept of — defaulted the
        // same way the commercial route's consumer already defaults them
        // for commercial (see BillGenerationFlow.jsx's own comment).
        advanceCredit: Number(member.advanceCredit) || 0,
      };
    }

    return NextResponse.json({
      success: true,
      billSeries: "RESIDENTIAL",
      periodId: currentPeriodId,
      previews,
      skipped,
    });
  } catch (error) {
    console.error("residential preview-bills error:", error);
    return NextResponse.json(
      { error: "The preview could not be built.", code: "PREVIEW_FAILED" },
      { status: 500 },
    );
  }
}

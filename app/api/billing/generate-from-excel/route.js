import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import Society from "@/models/Society";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import renderBillHtml from "@/lib/bill-renderer";
import cache from "@/lib/cache";
import { generateBill } from "@/lib/billing/generationService";
import { applyPaymentToBill } from "@/lib/billing/allocationService";
import { notifyBillCreated } from "@/lib/v1/notify";
import { isCommercialUnit } from "@/lib/commercial/constants";
import { authorize } from "@/lib/rbac/authorize";

// Ledger V2: THIN WRAPPER over the shared GenerationService. No billing math
// of its own — charges/interest/totals come from generateBill(), which
// recomputes from BillingHeads. The uploaded Excel's `bills[]` is used only
// to select which members to generate for.
export async function POST(request) {
  const gate = await authorize(request, "billing.bill.generate");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const { bills, billMonth, billYear } = await request.json();
    // Each row may carry its own billMonth/billYear (mixed-period uploads —
    // one flat catching up on last month while another starts a new one).
    // Fall back to the request-level values for older callers that don't.
    if (!bills?.length || (billMonth === undefined && bills.some((b) => b.billMonth === undefined))) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }
    const societyId = decoded.societyId;

    const society = await Society.findById(societyId).lean();
    const created = [];
    const errors = [];

    // Commercial (Shop/Office) units are billed exclusively through the
    // dedicated Commercial billing wizard, never through this Excel path.
    const rowMemberIds = [...new Set(bills.map((b) => String(b.memberId)).filter(Boolean))];
    const commercialMembers = rowMemberIds.length
      ? await Member.find({ _id: { $in: rowMemberIds } }).select("_id flatType").lean()
      : [];
    const commercialIds = new Set(
      commercialMembers.filter((m) => isCommercialUnit(m)).map((m) => String(m._id)),
    );

    for (const b of bills) {
      if (commercialIds.has(String(b.memberId))) {
        errors.push({ memberId: b.memberId, error: "Commercial unit — use the Commercial billing wizard instead" });
        continue;
      }
      const rowBillYear = b.billYear ?? billYear;
      const rowMonth = (b.billMonth ?? billMonth) + 1; // client sends 0-indexed month
      const billPeriodId = `${rowBillYear}-${String(rowMonth).padStart(2, "0")}`;
      try {
        const bill = await generateBill({
          societyId,
          memberId: b.memberId,
          year: rowBillYear,
          month: rowMonth,
          performedBy: decoded.userId,
        });

        const member = await Member.findById(b.memberId)
          .select("flatNo wing ownerName carpetAreaSqft contactNumber emailPrimary advanceCredit")
          .lean();
        const breakdown =
          bill.charges instanceof Map ? Object.fromEntries(bill.charges) : bill.charges || {};
        const unpaidBills = await Bill.find({
          societyId,
          memberId: b.memberId,
          status: { $in: ["Unpaid", "Partial", "Overdue"] },
          billPeriodId: { $ne: billPeriodId },
          isDeleted: { $ne: true },
        })
          .sort({ billYear: 1, billMonth: 1 })
          .lean();
        const renderResult = renderBillHtml(null, society, member, {
          breakdown,
          totalAmount: bill.currentCharges,
          previousBalance: parseFloat((bill.openingPrincipal + bill.openingInterest).toFixed(2)),
          prevRemPrincipal: bill.openingPrincipal,
          prevRemInt: bill.openingInterest,
          precomputedCurrInt: bill.currentInterest,
          precomputedMonthInterest: bill.billInterestBalance,
          balanceAmount: bill.balanceAmount,
          status: bill.status,
          billPeriod: billPeriodId,
          billDate: new Date(rowBillYear, rowMonth - 1, 1),
          dueDate: bill.dueDate,
          unpaidBills,
          recentTransactions: [],
        });
        await Bill.updateOne(
          { _id: bill._id },
          { $set: { billHtml: renderResult.billHtml || renderResult.html } },
        );

        if (bill.status !== "Scheduled" && (member?.advanceCredit || 0) > 0) {
          const applied = Math.min(parseFloat(member.advanceCredit.toFixed(2)), bill.totalBillDue);
          if (applied > 0) {
            await applyPaymentToBill({ billId: bill._id, payment: applied, performedBy: decoded.userId });
            await Member.updateOne({ _id: b.memberId }, { $inc: { advanceCredit: -applied } });
          }
        }

      created.push(bill._id);

  // Tell the member their new bill is ready (in-app notification + FCM
  // push). Skipped for Scheduled bills — they aren't due yet.
  if (bill.status !== "Scheduled") {
    await notifyBillCreated({
      billId: bill._id,
      societyId,
      memberId: b.memberId,
      amount: bill.totalBillDue,
    });
  }
} catch (err) {
        if (err.code === "P4_DUPLICATE") {
          errors.push({ memberId: b.memberId, error: `Bill already exists for ${billPeriodId}` });
        } else if (err.code === "MEMBER_NOT_FOUND") {
          errors.push({ memberId: b.memberId, error: "Member not found" });
        } else if (err.code && /^[BP]\d/.test(err.code)) {
          errors.push({ memberId: b.memberId, error: `Invariant ${err.code}: ${err.message}` });
        } else {
          console.error("generate-from-excel bill error", b.memberId, err.message);
          errors.push({ memberId: b.memberId, error: err.message });
        }
      }
    }

    await cache.del(`billing:generated:${societyId}`);
    await cache.del(`payments:outstanding:${societyId}`);
    await cache.del("admin:stats:global");
    return NextResponse.json({
      success: true,
      count: created.length,
      failed: errors.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error("generate-from-excel error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

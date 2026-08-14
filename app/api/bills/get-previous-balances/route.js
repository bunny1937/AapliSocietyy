import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import Member from "@/models/Member";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { resolveOpeningBalances } from "@/lib/billing/generationService";
import { authorizeAny } from "@/lib/rbac/authorize";

// Ledger V2: preview of what GenerationService will actually use as opening
// balances for the next bill. Uses the SAME single-lookup carry-forward
// (resolveOpeningBalances) as real generation, so this preview can never
// diverge from what generateBill() computes.
export async function POST(request) {
  try {
    // Also called from Generate Bills (pre-generation preview), not just
    // View Bills — same cross-page-dependency pattern as financial-years.
    const gate = await authorizeAny(request, ["billing.bill.view", "billing.dashboard.view"]);
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const body = await request.json();
    const { memberIds, billYear, billMonth, billSeries } = body;
    if (!billYear || !billMonth) {
      return NextResponse.json(
        { error: "billYear and billMonth are required" },
        { status: 400 },
      );
    }
    if (!memberIds || !Array.isArray(memberIds)) {
      return NextResponse.json(
        { error: "Invalid member IDs" },
        { status: 400 },
      );
    }
    const members = await Member.find({
      _id: { $in: memberIds },
      societyId: decoded.societyId,
    })
      .select("_id openingBalance openingPrincipal openingInterest advanceCredit")
      .lean();
    const memberMap = {};
    members.forEach((m) => {
      memberMap[m._id.toString()] = m;
    });
    const balances = {};
    for (const memberId of memberIds.filter(Boolean)) {
      const member = memberMap[memberId.toString()];
      if (!member) continue;

      const { openingPrincipal, openingInterest } = await resolveOpeningBalances({
        memberId,
        societyId: decoded.societyId,
        year: Number(billYear),
        month: Number(billMonth),
        member,
        billClass: billSeries || "RESIDENTIAL",
      });

      // Display-only — for the "pending since ..." UI message. NOT used for
      // any calculation; the numbers above (from resolveOpeningBalances) are
      // the only ones GenerationService will actually use.
      const currentPeriodId = `${billYear}-${String(billMonth).padStart(2, "0")}`;
      const unpaidBillsDisplay = await Bill.find({
        memberId,
        societyId: decoded.societyId,
        status: { $in: ["Unpaid", "Overdue", "Partial"] },
        billPeriodId: { $ne: currentPeriodId },
        isDeleted: { $ne: true },
        ...(billSeries ? { billSeries } : {}),
      })
        .sort({ billYear: 1, billMonth: 1 })
        .select("billPeriodId totalAmount balanceAmount dueDate status")
        .lean();

      const recentTransactions = await Transaction.find({
        memberId,
        societyId: decoded.societyId,
        isReversed: false,
      })
        .sort({ date: -1 })
        .limit(10)
        .select("date type category description amount balanceAfterTransaction billPeriodId")
        .lean();

      balances[memberId] = {
        balance: parseFloat((openingPrincipal + openingInterest).toFixed(2)),
        principalBalance: openingPrincipal,
        interestBalance: openingInterest,
        remInt: openingInterest,
        advanceCredit: member.advanceCredit || 0,
        unpaidBills: unpaidBillsDisplay,
        recentTransactions: recentTransactions.map((t) => ({
          date: t.date,
          type: t.type,
          category: t.category,
          description: t.description,
          amount: t.amount,
          balance: t.balanceAfterTransaction,
          billPeriod: t.billPeriodId,
        })),
      };
    }
    return NextResponse.json({ success: true, balances });
  } catch (error) {
    console.error("❌ Get previous balances error:", error);
    if (
      error.message?.includes("ENOTFOUND") ||
      error.message?.includes("timeout")
    ) {
      console.warn("⚠️ MongoDB unreachable, returning zero balances");
      return NextResponse.json({ success: true, balances: {} });
    }
    return NextResponse.json(
      { error: "Failed to get previous balances" },
      { status: 500 },
    );
  }
}

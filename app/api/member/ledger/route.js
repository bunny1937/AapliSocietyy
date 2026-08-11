import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import { authorize } from "@/lib/rbac/authorize";
import Transaction from "@/models/Transaction";
import Member from "@/models/Member";
export async function GET(request) {
  try {
    const gate = await authorize(request, "finance.ledger.view");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded || !decoded.memberId)
      return NextResponse.json({ error: "Not a member" }, { status: 403 });
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(
      100,
      parseInt(searchParams.get("limit") || "50", 10),
    );
    const financialYear = searchParams.get("financialYear");
    const query = {
      memberId: decoded.memberId,
      societyId: decoded.societyId,
      isReversed: false,
    };
    if (financialYear && financialYear !== "all")
      query.financialYear = financialYear;
    const [transactions, total] = await Promise.all([
      Transaction.find(query)
        .sort({ date: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Transaction.countDocuments(query),
    ]);
    const member = await Member.findById(decoded.memberId)
      .select("openingBalance")
      .lean();
    const totalDebit = transactions
      .filter((t) => t.type === "Debit")
      .reduce((s, t) => s + t.amount, 0);
    const totalCredit = transactions
      .filter((t) => t.type === "Credit")
      .reduce((s, t) => s + t.amount, 0);
    const currentBalance =
      transactions.length > 0
        ? transactions[0].balanceAfterTransaction
        : member?.openingBalance || 0;
    return NextResponse.json({
      success: true,
      transactions,
      summary: {
        totalDebit,
        totalCredit,
        currentBalance,
        openingBalance: member?.openingBalance || 0,
      },
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error", details: error.message },
      { status: 500 },
    );
  }
}

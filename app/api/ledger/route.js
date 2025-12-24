import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import Transaction from "@/models/Transaction";
import Member from "@/models/Member";

export async function GET(request) {
  try {
    await connectDB();

    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get("memberId");
    const category = searchParams.get("category");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    const query = { societyId: decoded.societyId };

    if (memberId && memberId !== "all") {
      query.memberId = memberId;
    }

    if (category && category !== "all") {
      query.category = category;
    }

    if (startDate) {
      query.date = { ...query.date, $gte: new Date(startDate) };
    }

    if (endDate) {
      query.date = { ...query.date, $lte: new Date(endDate) };
    }

    const transactions = await Transaction.find(query)
      .populate("memberId", "roomNo wing ownerName")
      .sort({ date: -1, createdAt: -1 });

    // Calculate summary
    const totalDebit = transactions
      .filter((t) => t.type === "Debit")
      .reduce((sum, t) => sum + t.amount, 0);

    const totalCredit = transactions
      .filter((t) => t.type === "Credit")
      .reduce((sum, t) => sum + t.amount, 0);

    // Get opening balance if specific member
    let openingBalance = 0;
    if (memberId && memberId !== "all") {
      const member = await Member.findById(memberId);
      openingBalance = member?.openingBalance || 0;
    }

    const netBalance = openingBalance + totalDebit - totalCredit;

    return NextResponse.json({
      success: true,
      transactions,
      summary: {
        totalTransactions: transactions.length,
        totalDebit,
        totalCredit,
        openingBalance,
        netBalance,
        balanceType: netBalance >= 0 ? "DR" : "CR",
      },
    });
  } catch (error) {
    console.error("Ledger fetch error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch ledger",
        details: error.message,
      },
      { status: 500 }
    );
  }
}

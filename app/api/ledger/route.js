import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import { authorize } from "@/lib/rbac/authorize";
import Transaction from "@/models/Transaction";
import Member from "@/models/Member";
import User from "@/models/User";
export async function GET(request) {
  try {
    const gate = await authorize(request, "finance.ledger.view");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    const url = new URL(request.url);
    const searchParams = url.searchParams;
    const memberId = searchParams.get("memberId");
    const category = searchParams.get("category");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(
      500,
      Math.max(1, parseInt(searchParams.get("limit") || "100")),
    );
    const skip = (page - 1) * limit;
    // ✅ ALWAYS scope to society + exclude reversed
    const query = {
      societyId: decoded.societyId,
      isReversed: { $ne: true },
    };
    // ✅ Member: honour both role-scoped (Member token) and explicit param
    if (decoded.role === "Member" && decoded.memberId) {
      query.memberId = decoded.memberId;
    } else if (memberId && memberId !== "all") {
      try {
        const mongoose = (await import("mongoose")).default;
        query.memberId = new mongoose.Types.ObjectId(memberId);
      } catch {
        query.memberId = memberId; // fallback
      }
    }
    if (category && category !== "all") {
      query.category = category;
    }
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }
    // ✅ Run count + paginated fetch in parallel
    const [total, transactions] = await Promise.all([
      Transaction.countDocuments(query),
      Transaction.find(query)
        .populate("memberId", "roomNo flatNo wing ownerName")
        .populate("createdBy", "name role email")
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(), // ← lean() avoids circular-ref serialization crashes
    ]);
    // aggregate does not auto-cast strings → ObjectId, must cast manually
    const aggQuery = { ...query };
    if (aggQuery.memberId && typeof aggQuery.memberId === "string") {
      const { Types } = await import("mongoose");
      try {
        aggQuery.memberId = new Types.ObjectId(aggQuery.memberId);
      } catch {}
    }
    // ✅ Summary calculated from this page's slice — also compute society-wide totals
    // for the filtered query (not just current page)
    let aggResult;
    try {
      [aggResult] = await Transaction.aggregate([
        {
          $match: {
            ...aggQuery,
            memberId:
              typeof aggQuery.memberId === "string"
                ? new (require("mongoose").Types.ObjectId)(aggQuery.memberId)
                : aggQuery.memberId,
          },
        },
        {
          $group: {
            _id: null,
            totalDebit: {
              $sum: { $cond: [{ $eq: ["$type", "Debit"] }, "$amount", 0] },
            },
            totalCredit: {
              $sum: { $cond: [{ $eq: ["$type", "Credit"] }, "$amount", 0] },
            },
          },
        },
      ]);
    } catch (aggErr) {
      console.error("Ledger aggregate error:", aggErr);
      aggResult = null;
    }
    const totalDebit = aggResult?.totalDebit || 0;
    const totalCredit = aggResult?.totalCredit || 0;
    // Opening balance only meaningful for single-member view
    let openingBalance = 0;
    const effectiveMemberId =
      decoded.role === "Member" ? decoded.memberId : memberId;
    if (effectiveMemberId && effectiveMemberId !== "all") {
      const member = await Member.findById(effectiveMemberId)
        .select("openingBalance openingPrincipal openingInterest")
        .lean();
      openingBalance = member?.openingBalance || 0;
    }
    const netBalance = openingBalance + totalDebit - totalCredit;
    return NextResponse.json({
      success: true,
      transactions,
      summary: {
        totalTransactions: total,
        totalDebit,
        totalCredit,
        openingBalance,
        netBalance,
        balanceType: netBalance >= 0 ? "DR" : "CR",
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Ledger fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch ledger", details: error.message },
      { status: 500 },
    );
  }
}

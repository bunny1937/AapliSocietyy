import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
// Registers the User schema in this lambda so populate("createdBy") cannot
// throw MissingSchemaError (was returning 500 on ledger/payment fetches).
import User from "@/models/User";
void User;
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import cache from "@/lib/cache";
import { authorize } from "@/lib/rbac/authorize";
export async function GET(request) {
  try {
    const gate = await authorize(request, "finance.payment.view");
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
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const paymentMode = searchParams.get("paymentMode");
    const limit = parseInt(searchParams.get("limit") || "100");
    const query = {
      societyId: decoded.societyId,
      type: "Credit",
      category: { $in: ["Payment", "Adjustment"] },
      isReversed: false,
    };
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }
    if (paymentMode) {
      query.paymentMode = paymentMode;
    }
    const cacheKey = `payments:list:${decoded.societyId}`;
    const cached = await cache.get(cacheKey);
    if (cached) return NextResponse.json(cached);
    const payments = await Transaction.find(query)
      .populate("memberId", "roomNo wing ownerName contact")
      .populate("createdBy", "name email")
      .sort({ date: -1, createdAt: -1 })
      .limit(limit)
      .lean();
    const totalAmount = await Transaction.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    return NextResponse.json({
      payments,
      count: payments.length,
      totalAmount: totalAmount[0]?.total || 0,
    });
    await cache.set(cacheKey, responseData, 60);
    return NextResponse.json(responseData);
  } catch (error) {
    console.error("Fetch payments error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
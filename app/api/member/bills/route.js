import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import { authorize } from "@/lib/rbac/authorize";
import Bill from "@/models/Bill";
import mongoose from "mongoose";
export async function GET(request) {
  try {
    const gate = await authorize(request, "billing.bill.view");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded || !decoded.memberId)
      return NextResponse.json({ error: "Not a member" }, { status: 403 });
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const limit = parseInt(searchParams.get("limit") || "50");
    const page = parseInt(searchParams.get("page") || "1");
    const memberId = new mongoose.Types.ObjectId(decoded.memberId);
    const societyId = new mongoose.Types.ObjectId(decoded.societyId);
    const query = {
      memberId,
      societyId,
      isDeleted: { $ne: true },
    };
    if (status && status !== "all") {
      query.status = status;
    } else {
      query.status = { $ne: "Scheduled" };
    }
    const [bills, total, agg] = await Promise.all([
      Bill.find(query)
        .sort({ billYear: -1, billMonth: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("-billHtml") // exclude heavy html for list
        .lean(),
      Bill.countDocuments(query),
      Bill.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: "$totalAmount" },
            totalPaid: { $sum: "$amountPaid" },
            totalOutstanding: {
              $sum: {
                $cond: [{ $ne: ["$status", "Paid"] }, "$balanceAmount", 0],
              },
            },
          },
        },
      ]),
    ]);
    const aggRow = agg[0] || {};
    const summary = {
      total,
      totalAmount: aggRow.totalAmount || 0,
      totalPaid: aggRow.totalPaid || 0,
      totalOutstanding: aggRow.totalOutstanding || 0,
    };
    return NextResponse.json({
      success: true,
      bills,
      summary,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 },
    );
  }
}

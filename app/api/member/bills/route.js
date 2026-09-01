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
      // "Unpaid" from the client covers Partial too — Partial isn't a
      // separate bucket to filter by, just a bill with some (not all) of
      // itself paid. Still shown as its own label on each bill, just not a
      // distinct filter tab.
      query.status = status === "Unpaid" ? { $in: ["Unpaid", "Partial"] } : status;
    } else {
      query.status = { $ne: "Scheduled" };
    }
    const [bills, total, agg, latestBill] = await Promise.all([
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
          },
        },
      ]),
      // Each bill's balanceAmount is CUMULATIVE (resolveOpeningBalances seeds
      // the next bill's opening straight from the previous one's closing —
      // lib/billing/generationService.js), so summing balanceAmount across
      // every non-Paid bill counts the same carried-forward rupees once per
      // month it's stayed open. An older bill can also go stale-Partial even
      // after its balance was fully absorbed and paid off via a later bill
      // (nothing retroactively closes it) — that stale balance would get
      // summed in here too. What's actually owed right now is always just
      // the LATEST bill's own balance (see outstandingForBills() in
      // lib/billing/paymentApplication.js for the same rule applied
      // server-side to payments).
      Bill.findOne({ memberId, societyId, isDeleted: { $ne: true }, status: { $ne: "Scheduled" } })
        .sort({ billYear: -1, billMonth: -1 })
        .select("status balanceAmount")
        .lean(),
    ]);
    const aggRow = agg[0] || {};
    const summary = {
      total,
      totalAmount: aggRow.totalAmount || 0,
      totalPaid: aggRow.totalPaid || 0,
      totalOutstanding: latestBill && latestBill.status !== "Paid" ? latestBill.balanceAmount || 0 : 0,
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

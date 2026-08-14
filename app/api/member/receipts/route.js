import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import { authorize } from "@/lib/rbac/authorize";
import Receipt from "@/models/Receipt";
export async function GET(request) {
  try {
    const gate = await authorize(request, "finance.receipt.view");
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
    const limit = parseInt(searchParams.get("limit") || "20");
    const [receipts, total] = await Promise.all([
      Receipt.find({ memberId: decoded.memberId, societyId: decoded.societyId })
        .sort({ paidAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Receipt.countDocuments({
        memberId: decoded.memberId,
        societyId: decoded.societyId,
      }),
    ]);
    return NextResponse.json({
      success: true,
      receipts,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 },
    );
  }
}

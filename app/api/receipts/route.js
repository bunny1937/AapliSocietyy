import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Receipt from "@/models/Receipt";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { authorize } from "@/lib/rbac/authorize";
export async function GET(request) {
  try {
    const gate = await authorize(request, "finance.receipt.view");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const billId = searchParams.get("billId");
    const memberId = searchParams.get("memberId");
    const query = { societyId: decoded.societyId };
    if (billId) query.billId = billId;
    if (memberId) query.memberId = memberId;
    const receipts = await Receipt.find(query)
      .sort({ paidAt: -1 })
      .lean();
    return NextResponse.json({ success: true, receipts });
  } catch (err) {
    console.error("Receipts fetch error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import {
  verifyToken,
  extractTokenFromHeader,
  getTokenFromRequest,
} from "@/lib/jwt";
import cache from "@/lib/cache";
import { authorize } from "@/lib/rbac/authorize";
export async function GET(request) {
  const gate = await authorize(request, "billing.bill.view");
  if (!gate.ok) return gate.response;
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
    if (decoded.role === "Member") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { searchParams } = new URL(request.url);
    const billPeriodId = searchParams.get("billPeriodId");
    const rawStatus = searchParams.get("status");
    const ALLOWED_STATUSES = ["Paid", "Unpaid", "Overdue", "Partial"];
    const status = rawStatus && ALLOWED_STATUSES.includes(rawStatus) ? rawStatus : null;
    const memberId = searchParams.get("memberId");
    const query = { societyId: decoded.societyId };
    if (billPeriodId) {
      query.billPeriodId = billPeriodId;
    }
    if (status) {
      query.status = status;
    }
    if (memberId) {
      query.memberId = memberId;
    }
    const cacheKey = `billing:list:${decoded.societyId}:${billPeriodId || "all"}:${status || "all"}`;
    const cached = await cache.get(cacheKey);
    if (cached) return NextResponse.json(cached);
    const bills = await Bill.find(query)
      .populate("memberId", "flatNo wing ownerName areaSqFt contact")
      .sort({
        billYear: -1,
        billMonth: -1,
        "memberId.wing": 1,
        "memberId.flatNo": 1,
      })
      .lean();
    const responseData = { bills, count: bills.length };
    await cache.set(cacheKey, responseData, 120);
    return NextResponse.json(responseData);
  } catch (error) {
    console.error("Fetch bills error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

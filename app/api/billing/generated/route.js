import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
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
    // Query Bill model - no filter, show ALL bills
    const cacheKey = `billing:generated:${decoded.societyId}`;
    const cached = await cache.get(cacheKey);
    if (cached) return NextResponse.json(cached);
    const bills = await Bill.find({
      societyId: decoded.societyId,
      isDeleted: { $ne: true },
    })
      .select(
  "billPeriodId billMonth billYear memberId societyId previousBalance interestAmount openingPrincipal openingInterest currentInterest currentCharges currentBillTotal subtotal charges totalAmount balanceAmount amountPaid dueDate status billHtml generatedAt createdAt unitClass billSeries billNo",
)
      .populate(
        "memberId",
        "flatNo wing ownerName carpetAreaSqft contactNumber emailPrimary",
      )
      .sort({ billYear: -1, billMonth: -1, createdAt: -1 })
      .lean();
    console.log("📋 Found bills in /api/billing/generated:", bills.length);
    // Serialize _id explicitly to avoid ObjectId serialization issues
    const serializedBills = bills.map((b) => ({
      ...b,
      _id: b._id?.toString(),
      memberId: b.memberId
        ? {
            ...b.memberId,
            _id: b.memberId._id?.toString(),
          }
        : null,
      societyId: b.societyId?.toString?.() || b.societyId,
    }));
    const responseData = { success: true, bills: serializedBills };
    await cache.set(cacheKey, responseData, 120);
    return NextResponse.json(responseData);
  } catch (error) {
    console.error("Generated bills fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch bills" },
      { status: 500 },
    );
  }
}

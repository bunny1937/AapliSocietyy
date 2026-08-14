import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import BillingHead from "@/models/BillingHead";
import { authorize } from "@/lib/rbac/authorize";
export async function GET(request) {
  try {
    const gate = await authorize(request, "billing.config.view");
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
    const billingHeads = await BillingHead.find({
      societyId: decoded.societyId,
      isActive: true,
    }).sort({ order: 1 });
    return NextResponse.json({
      success: true,
      billingHeads,
    });
  } catch (error) {
    console.error("Billing config fetch error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch billing configuration",
      },
      { status: 500 }
    );
  }
}

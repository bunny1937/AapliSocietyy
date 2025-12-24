import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import BillingHead from "@/models/BillingHead";

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
        details: error.message,
      },
      { status: 500 }
    );
  }
}

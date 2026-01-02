import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";  
import Member from "@/models/Member";  
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";

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

    // Query Bill model - no filter, show ALL bills
    const bills = await Bill.find({
      societyId: decoded.societyId
    })
      .populate("memberId", "flatNo wing ownerName areaSqFt contact")
      .sort({ billYear: -1, billMonth: -1, createdAt: -1 })
      .lean();

    console.log('📋 Found bills in /api/billing/generated:', bills.length);

    return NextResponse.json({
      success: true,
      bills,
    });
  } catch (error) {
    console.error("Generated bills fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch bills" },
      { status: 500 }
    );
  }
}

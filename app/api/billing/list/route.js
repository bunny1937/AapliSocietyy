import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import {
  verifyToken,
  extractTokenFromHeader,
  getTokenFromRequest,
} from "@/lib/jwt";

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

    const { searchParams } = new URL(request.url);
    const billPeriodId = searchParams.get("billPeriodId");
    const status = searchParams.get("status");
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

    const bills = await Bill.find(query)
      .populate("memberId", "roomNo wing ownerName areaSqFt contact")
      .sort({
        billYear: -1,
        billMonth: -1,
        "memberId.wing": 1,
        "memberId.roomNo": 1,
      })
      .lean();

    return NextResponse.json({
      bills,
      count: bills.length,
    });
  } catch (error) {
    console.error("Fetch bills error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

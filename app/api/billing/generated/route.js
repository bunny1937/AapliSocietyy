import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
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

    const bills = await Transaction.find({
      societyId: decoded.societyId,
      category: "Maintenance",
      billHtml: { $exists: true },
    })
      .populate("memberId", "roomNo wing ownerName areaSqFt")
      .sort({ date: -1, createdAt: -1 })
      .lean();

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

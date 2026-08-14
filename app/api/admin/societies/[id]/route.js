import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import Member from "@/models/Member";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import { validateAdminRequest } from "@/lib/admin-middleware";
export async function GET(request, { params }) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  try {
    await connectDB();
    const { id: societyId } = await params;
    // Fetch society
    const society = await Society.findById(societyId).lean();
    if (!society) {
      return NextResponse.json({ error: "Society not found" }, { status: 404 });
    }
    // Get stats
    const [memberCount, billCount, transactionCount] = await Promise.all([
      Member.countDocuments({ societyId }),
      Bill.countDocuments({ societyId }),
      Transaction.countDocuments({ societyId }),
    ]);
    return NextResponse.json({
      success: true,
      society: {
        ...society,
        stats: {
          members: memberCount,
          bills: billCount,
          transactions: transactionCount,
        },
      },
    });
  } catch (error) {
    console.error("Society fetch error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

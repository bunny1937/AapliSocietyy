import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import Member from "@/models/Member";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import { logAdminActivity } from "@/lib/export-to-admin-db";
import { validateAdminRequest } from "@/lib/admin-middleware";
export async function GET(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  const admin = validation.admin;
  try {
    await connectDB();
    const societies = await Society.find({})
      .select("-__v")
      .sort({ createdAt: -1 })
      .lean();
    const societiesWithStats = await Promise.all(
      societies.map(async (society) => {
        const [memberCount, billCount, transactionCount] = await Promise.all([
          Member.countDocuments({ societyId: society._id }),
          Bill.countDocuments({ societyId: society._id }),
          Transaction.countDocuments({ societyId: society._id }),
        ]);
        return {
          ...society,
          stats: {
            members: memberCount,
            bills: billCount,
            transactions: transactionCount,
          },
        };
      }),
    );
    await logAdminActivity({
      adminId: admin.userId,
      adminName: admin.email,
      action: "VIEW_DATA",
      details: {
        resource: "societies",
        count: societiesWithStats.length,
      },
      ipAddress: request.headers.get("x-forwarded-for") || "unknown",
      userAgent: request.headers.get("user-agent") || "unknown",
    });
    return NextResponse.json({
      success: true,
      societies: societiesWithStats,
      total: societiesWithStats.length,
    });
  } catch (error) {
    console.error("Admin societies fetch error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
export async function PUT(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  const admin = validation.admin;
  try {
    await connectDB();
    const { societyId, updates } = await request.json();
    const society = await Society.findByIdAndUpdate(societyId, updates, {
      new: true,
      runValidators: true,
    });
    if (!society) {
      return NextResponse.json({ error: "Society not found" }, { status: 404 });
    }
    await logAdminActivity({
      adminId: admin.userId,
      adminName: admin.email,
      action: "UPDATE_CONFIG",
      targetSociety: {
        societyId: society._id,
        societyName: society.name,
      },
      details: { updates },
      ipAddress: request.headers.get("x-forwarded-for") || "unknown",
      userAgent: request.headers.get("user-agent") || "unknown",
    });
    return NextResponse.json({
      success: true,
      message: "Society updated successfully",
      society,
    });
  } catch (error) {
    console.error("Admin society update error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import BillingHead from "@/models/BillingHead";

export async function POST(request) {
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

    // Check if billing heads already exist
    const existing = await BillingHead.countDocuments({
      societyId: decoded.societyId,
    });

    if (existing > 0) {
      return NextResponse.json(
        {
          error: "Billing heads already configured",
        },
        { status: 400 }
      );
    }

    // Create default billing heads
    const defaultHeads = [
      {
        headName: "Maintenance",
        calculationType: "Per Sq Ft",
        defaultAmount: 2, // ₹2 per sq ft
        isActive: true,
        order: 1,
        societyId: decoded.societyId,
      },
      {
        headName: "Sinking Fund",
        calculationType: "Per Sq Ft",
        defaultAmount: 0.5, // ₹0.5 per sq ft
        isActive: true,
        order: 2,
        societyId: decoded.societyId,
      },
      {
        headName: "Parking Charges",
        calculationType: "Fixed",
        defaultAmount: 500, // ₹500 flat
        isActive: true,
        order: 3,
        societyId: decoded.societyId,
      },
    ];

    const created = await BillingHead.insertMany(defaultHeads);

    return NextResponse.json({
      success: true,
      message: `Created ${created.length} default billing heads`,
      billingHeads: created,
    });
  } catch (error) {
    console.error("Setup error:", error);
    return NextResponse.json(
      {
        error: "Failed to setup billing heads",
        details: error.message,
      },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
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

    const society = await Society.findById(decoded.societyId).lean();

    return NextResponse.json({
      success: true,
      template: society?.billTemplate || null,
    });
  } catch (error) {
    console.error("Template fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch template" },
      { status: 500 }
    );
  }
}

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

    if (decoded.role === "Accountant") {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    const { name, html } = await request.json();

    if (!html || !html.trim()) {
      return NextResponse.json(
        { error: "HTML content is required" },
        { status: 400 }
      );
    }

    const society = await Society.findByIdAndUpdate(
      decoded.societyId,
      {
        billTemplate: {
          name: name || "Default Bill Template",
          html: html.trim(),
          updatedAt: new Date(),
        },
      },
      { new: true }
    );

    return NextResponse.json({
      success: true,
      message: "Template saved successfully",
      template: society.billTemplate,
    });
  } catch (error) {
    console.error("Template save error:", error);
    return NextResponse.json(
      { error: "Failed to save template", details: error.message },
      { status: 500 }
    );
  }
}

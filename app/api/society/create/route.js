import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";

import { matrixConfigSchema } from "@/lib/validators";

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

    if (decoded.role !== "Admin") {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validationResult = matrixConfigSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Validation failed", details: validationResult.error.errors },
        { status: 400 }
      );
    }

    const updatedSociety = await Society.findByIdAndUpdate(
      decoded.societyId,
      {
        $set: {
          matrixConfig: {
            L: validationResult.data.L,
            R: validationResult.data.R,
          },
          billingHeads: validationResult.data.billingHeads,
        },
      },
      { new: true, runValidators: true }
    );

    return NextResponse.json({
      message: "Matrix configuration saved successfully",
      society: updatedSociety,
    });
  } catch (error) {
    console.error("Matrix config error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import AuditLog from "@/models/AuditLog";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";

import { societyConfigSchema } from "@/lib/validators";

export async function PUT(request) {
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

    if (decoded.role !== "Admin" && decoded.role !== "Secretary") {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validationResult = societyConfigSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Validation failed", details: validationResult.error.errors },
        { status: 400 }
      );
    }

    const oldSociety = await Society.findById(decoded.societyId);

    const updatedSociety = await Society.findByIdAndUpdate(
      decoded.societyId,
      { $set: validationResult.data },
      { new: true, runValidators: true }
    );

    await AuditLog.create({
      userId: decoded.userId,
      societyId: decoded.societyId,
      action: "UPDATE_SOCIETY_CONFIG",
      oldData: oldSociety,
      newData: updatedSociety,
      timestamp: new Date(),
    });

    return NextResponse.json({
      message: "Society configuration updated successfully",
      society: updatedSociety,
    });
  } catch (error) {
    console.error("Update society config error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

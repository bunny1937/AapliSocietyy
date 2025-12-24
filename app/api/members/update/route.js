import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import AuditLog from "@/models/AuditLog";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";

import { memberSchema } from "@/lib/validators";

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

    const body = await request.json();
    const { memberId, ...updateData } = body;

    if (!memberId) {
      return NextResponse.json(
        { error: "Member ID required" },
        { status: 400 }
      );
    }

    const validationResult = memberSchema.safeParse(updateData);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Validation failed", details: validationResult.error.errors },
        { status: 400 }
      );
    }

    const oldMember = await Member.findOne({
      _id: memberId,
      societyId: decoded.societyId,
    });

    if (!oldMember) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    const updatedMember = await Member.findByIdAndUpdate(
      memberId,
      { $set: validationResult.data },
      { new: true, runValidators: true }
    );

    await AuditLog.create({
      userId: decoded.userId,
      societyId: decoded.societyId,
      action: "UPDATE_MEMBER",
      oldData: oldMember,
      newData: updatedMember,
      timestamp: new Date(),
    });

    return NextResponse.json({
      message: "Member updated successfully",
      member: updatedMember,
    });
  } catch (error) {
    console.error("Update member error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
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

    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get("memberId");

    if (!memberId) {
      return NextResponse.json(
        { error: "Member ID required" },
        { status: 400 }
      );
    }

    const member = await Member.findOneAndDelete({
      _id: memberId,
      societyId: decoded.societyId,
    });

    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    await AuditLog.create({
      userId: decoded.userId,
      societyId: decoded.societyId,
      action: "DELETE_MEMBER",
      oldData: member,
      timestamp: new Date(),
    });

    return NextResponse.json({ message: "Member deleted successfully" });
  } catch (error) {
    console.error("Delete member error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

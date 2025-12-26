import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import Member from "@/models/Member";
import User from "@/models/User";
import { AuditLog } from "@/models/AuditLog";

// GET: Fetch member's own profile
export async function GET(request) {
  try {
    await connectDB();

    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded || decoded.role !== "Member") {
      return NextResponse.json(
        { error: "Member access only" },
        { status: 403 }
      );
    }

    // Fetch member using memberId from token (NOT from request params)
    const member = await Member.findOne({
      _id: decoded.memberId,
      societyId: decoded.societyId,
    }).lean();

    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    const user = await User.findOne({
      memberId: decoded.memberId,
      societyId: decoded.societyId,
    })
      .select("email")
      .lean();

    return NextResponse.json({
      success: true,
      member: {
        ...member,
        email: user?.email,
      },
    });
  } catch (error) {
    console.error("Fetch profile error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT: Update member's own profile (limited fields)
export async function PUT(request) {
  try {
    await connectDB();

    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded || decoded.role !== "Member") {
      return NextResponse.json(
        { error: "Member access only" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { ownerName, contact } = body;

    // Members can only update their name and contact
    const allowedUpdates = {};
    if (ownerName) allowedUpdates.ownerName = ownerName;
    if (contact) allowedUpdates.contact = contact;

    const oldMember = await Member.findById(decoded.memberId).lean();

    const updatedMember = await Member.findByIdAndUpdate(
      decoded.memberId,
      { $set: allowedUpdates },
      { new: true, runValidators: true }
    );

    await AuditLog.create({
      userId: decoded.userId,
      societyId: decoded.societyId,
      action: "MEMBER_SELF_UPDATE",
      oldData: oldMember,
      newData: updatedMember,
      timestamp: new Date(),
    });

    return NextResponse.json({
      success: true,
      message: "Profile updated successfully",
      member: updatedMember,
    });
  } catch (error) {
    console.error("Update profile error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

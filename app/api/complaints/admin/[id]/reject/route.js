import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import Complaint from "@/models/Complaint";
import { authorize } from "@/lib/rbac/authorize";
export async function POST(request, { params }) {
  try {
    const gate = await authorize(request, "complaint.complaint.reject");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await params;
    const { reason } = await request.json();
    if (!reason || reason.trim().length < 120 || reason.trim().length > 500) {
      return NextResponse.json(
        { error: "Rejection reason must be between 120 and 500 characters" },
        { status: 400 },
      );
    }
    const complaint = await Complaint.findOne({
      _id: id,
      societyId: gate.context.societyId || decoded.societyId,
      status: "PENDING",
    });
    if (!complaint) {
      return NextResponse.json(
        { error: "Complaint not found or not pending" },
        { status: 404 },
      );
    }
    complaint.status = "REJECTED";
    complaint.adminRejectionReason = reason.trim();
    complaint.reviewedBy = decoded.userId;
    complaint.reviewedAt = new Date();
    await complaint.save();
    return NextResponse.json({
      success: true,
      message: "Complaint rejected",
      complaint,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 },
    );
  }
}

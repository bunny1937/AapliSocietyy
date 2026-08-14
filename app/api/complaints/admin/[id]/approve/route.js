import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import Complaint from "@/models/Complaint";
import { authorize } from "@/lib/rbac/authorize";
export async function POST(request, { params }) {
  try {
    const gate = await authorize(request, "complaint.complaint.approve");
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
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // auto-expire after 7 days
    complaint.status = "APPROVED";
    complaint.reviewedBy = decoded.userId;
    complaint.reviewedAt = new Date();
    complaint.expiresAt = expiresAt;
    await complaint.save();
    return NextResponse.json({
      success: true,
      message: "Complaint approved",
      complaint,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 },
    );
  }
}

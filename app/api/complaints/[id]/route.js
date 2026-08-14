import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import mongoose from "mongoose";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import { authorize } from "@/lib/rbac/authorize";
import Complaint from "@/models/Complaint";
import ComplaintReply from "@/models/ComplaintReply";
export async function GET(request, { params }) {
  try {
    const gate = await authorize(request, "complaint.complaint.view");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const { id } = await params;
    // Reject malformed ObjectIds before querying (avoids Mongoose CastError → 500)
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { error: "Invalid complaint id" },
        { status: 400 },
      );
    }
    const isAdmin = ["Admin", "Secretary"].includes(decoded.role);
    const isMember = decoded.role === "Member";
    // --- Fetch complaint ---
    const complaint = await Complaint.findOne({
      _id: id,
      societyId: gate.context.societyId || decoded.societyId, // always scope to their society
    }).lean();
    if (!complaint) {
      return NextResponse.json(
        { error: "Complaint not found" },
        { status: 404 },
      );
    }
    // --- Access control ---
    if (isMember) {
      const isOwner =
        complaint.memberId.toString() === decoded.memberId.toString();
      const isPublic = complaint.status === "APPROVED";
      if (!isOwner && !isPublic) {
        // Member can only see: their own complaint OR approved public complaints
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    // --- Fetch replies ---
    const replies = await ComplaintReply.find({ complaintId: id })
      .sort({ createdAt: 1 })
      .lean();
    // --- Strip sensitive fields for non-owners / public view ---
    let responseComplaint = { ...complaint };
    if (isMember) {
      const isOwner =
        complaint.memberId.toString() === decoded.memberId.toString();
      if (!isOwner) {
        // Public view: hide memberId and rejection reason
        delete responseComplaint.memberId;
        delete responseComplaint.adminRejectionReason;
        delete responseComplaint.reviewedBy;
      }
    }
    // Admin gets full data including memberId (real identity)
    // already present in responseComplaint — no stripping needed
    return NextResponse.json({
      success: true,
      complaint: responseComplaint,
      replies,
    });
  } catch (error) {
    console.error("Get complaint error:", error);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 },
    );
  }
}

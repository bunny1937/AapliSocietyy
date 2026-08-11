import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import { authorize } from "@/lib/rbac/authorize";
import Complaint from "@/models/Complaint";
import ComplaintReply from "@/models/ComplaintReply";
export async function GET(request) {
  try {
    const gate = await authorize(request, "complaint.complaint.view");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded || decoded.role !== "Member") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const searchParams = new URL(request.url).searchParams;
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const query = {
      memberId: decoded.memberId, // server-side ownership: only their own
      societyId: decoded.societyId,
    };
    const [complaints, total] = await Promise.all([
      Complaint.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Complaint.countDocuments(query),
    ]);
    // Fetch replies for rejected complaints (for appeal thread)
    const rejectedIds = complaints
      .filter((c) => c.status === "REJECTED" || c.status === "CLOSED")
      .map((c) => c._id);
    const replies = rejectedIds.length
      ? await ComplaintReply.find({ complaintId: { $in: rejectedIds } })
          .sort({ createdAt: 1 })
          .lean()
      : [];
    const repliesMap = {};
    replies.forEach((r) => {
      const key = r.complaintId.toString();
      if (!repliesMap[key]) repliesMap[key] = [];
      repliesMap[key].push(r);
    });
    const complaintsWithReplies = complaints.map((c) => ({
      ...c,
      replies: repliesMap[c._id.toString()] || [],
    }));
    return NextResponse.json({
      success: true,
      complaints: complaintsWithReplies,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error", details: error.message },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import Complaint from "@/models/Complaint";
import Member from "@/models/Member";
import { authorize } from "@/lib/rbac/authorize";
export async function GET(request) {
  try {
    const gate = await authorize(request, "complaint.complaint.view");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const searchParams = new URL(request.url).searchParams;
    const status = searchParams.get("status") || "PENDING";
    const category = searchParams.get("category");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const query = { societyId: gate.context.societyId || decoded.societyId };
    if (status !== "all") query.status = status;
    if (category && category !== "all") query.category = category;
    const [complaints, total] = await Promise.all([
      Complaint.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Complaint.countDocuments(query),
    ]);
    // Enrich with member info (admin sees real identity)
    const memberIds = [
      ...new Set(complaints.map((c) => c.memberId.toString())),
    ];
    const members = await Member.find({ _id: { $in: memberIds } })
      .select("_id ownerName wing flatNo contactNumber emailPrimary")
      .lean();
    const memberMap = {};
    members.forEach((m) => (memberMap[m._id.toString()] = m));
    const enriched = complaints.map((c) => ({
      ...c,
      member: memberMap[c.memberId.toString()] || null,
    }));
    return NextResponse.json({
      success: true,
      complaints: enriched,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error", details: error.message },
      { status: 500 },
    );
  }
}

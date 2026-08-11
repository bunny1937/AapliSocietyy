import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import Notice from "@/models/Notice";
import { authorize } from "@/lib/rbac/authorize";
export async function POST(request, { params }) {
  try {
    const gate = await authorize(request, "notice.notice.view");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded || decoded.role !== "Member") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await params;
    const notice = await Notice.findOne({
      _id: id,
      societyId: decoded.societyId,
      isDeleted: false,
      priority: "urgent",
    });
    if (!notice) {
      return NextResponse.json(
        { error: "Notice not found or not urgent" },
        { status: 404 },
      );
    }
    const alreadyAcknowledged = notice.acknowledgedBy.some(
      (a) => a.memberId.toString() === decoded.memberId.toString(),
    );
    if (!alreadyAcknowledged) {
      notice.acknowledgedBy.push({
        memberId: decoded.memberId,
        acknowledgedAt: new Date(),
      });
      // Also mark as viewed
      const alreadyViewed = notice.viewedBy.some(
        (v) => v.memberId.toString() === decoded.memberId.toString(),
      );
      if (!alreadyViewed) {
        notice.viewedBy.push({
          memberId: decoded.memberId,
          viewedAt: new Date(),
        });
      }
      await notice.save();
    }
    return NextResponse.json({ success: true, message: "Acknowledged" });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error", details: error.message },
      { status: 500 },
    );
  }
}

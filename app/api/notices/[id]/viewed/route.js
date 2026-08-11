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
    // Add to viewedBy only if not already present (idempotent)
    await Notice.updateOne(
      {
        _id: id,
        societyId: decoded.societyId,
        isDeleted: false,
        "viewedBy.memberId": { $ne: decoded.memberId },
      },
      {
        $push: {
          viewedBy: { memberId: decoded.memberId, viewedAt: new Date() },
        },
      },
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error", details: error.message },
      { status: 500 },
    );
  }
}

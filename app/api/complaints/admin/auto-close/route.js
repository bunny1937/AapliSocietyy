import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import Complaint from "@/models/Complaint";
export async function POST(request) {
  try {
    await connectDB();
    // Admin-only: this endpoint mutates complaint state in bulk
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const decoded = verifyToken(token);
    if (!decoded || !["Admin", "Secretary"].includes(decoded.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const result = await Complaint.updateMany(
      {
        status: "REJECTED",
        $or: [
          { lastReplyAt: { $lt: cutoff } },
          { lastReplyAt: null, updatedAt: { $lt: cutoff } },
        ],
      },
      { $set: { status: "CLOSED" } },
    );
    return NextResponse.json({ success: true, closed: result.modifiedCount });
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

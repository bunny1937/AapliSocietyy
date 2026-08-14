import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import Notification from "@/models/Notification";
export async function POST(request) {
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    // Find all unread notifications for this user
    await Notification.updateMany(
      {
        societyId: decoded.societyId,
        isDeleted: false,
        "readBy.userId": { $ne: decoded.userId },
      },
      {
        $push: { readBy: { userId: decoded.userId, readAt: new Date() } },
      },
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 },
    );
  }
}

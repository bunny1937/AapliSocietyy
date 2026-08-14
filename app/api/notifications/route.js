import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import Notification from "@/models/Notification";
import Member from "@/models/Member";
import { emitNotification } from "@/lib/socket-server";
// POST /api/notifications — Admin sends notification
export async function POST(request) {
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded || !["Admin", "Secretary"].includes(decoded.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const {
      type,
      title,
      message,
      recipientType,
      recipientIds = [],
      actionUrl,
      expiresInDays,
    } = await request.json();
    if (!title?.trim() || !message?.trim() || !type || !recipientType) {
      return NextResponse.json(
        { error: "title, message, type, recipientType are required" },
        { status: 400 },
      );
    }
    let expiresAt = null;
    if (expiresInDays) {
      expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    }
    const notification = await Notification.create({
      societyId: decoded.societyId,
      createdBy: decoded.userId,
      createdByName: decoded.name || "Admin",
      type,
      title: title.trim(),
      message: message.trim(),
      recipientType,
      recipientIds,
      actionUrl: actionUrl || null,
      expiresAt,
    });
    // Emit realtime event
    emitNotification(notification);
    return NextResponse.json({ success: true, notification }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 },
    );
  }
}
// GET /api/notifications — Fetch for current user with unread count
export async function GET(request) {
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const searchParams = new URL(request.url).searchParams;
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const { societyId, userId, memberId, role } = decoded;
    // Build recipient filter — show notification if:
    // recipientType=all OR user's memberId/wing is in recipientIds
    const member = memberId
      ? await Member.findById(memberId).select("wing flatNo").lean()
      : null;
    const recipientFilter = {
      $or: [
        { recipientType: "all" },
        {
          recipientType: "member",
          recipientIds: memberId ? memberId.toString() : "",
        },
        { recipientType: "wing", recipientIds: member?.wing || "__none__" },
        {
          recipientType: "flats",
          recipientIds: memberId ? memberId.toString() : "",
        },
      ],
    };
    // Admins see all notifications they sent + all targeted at them
    const baseQuery = ["Admin", "Secretary"].includes(role)
      ? { societyId, isDeleted: false }
      : { societyId, isDeleted: false, ...recipientFilter };
    const [notifications, total] = await Promise.all([
      Notification.find(baseQuery)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Notification.countDocuments(baseQuery),
    ]);
    // Per-notification read flag for current user
    const enriched = notifications.map((n) => ({
      ...n,
      isRead: n.readBy.some((r) => r.userId?.toString() === userId?.toString()),
      readCount: n.readBy.length,
    }));
    const unreadCount = enriched.filter((n) => !n.isRead).length;
    return NextResponse.json({
      success: true,
      notifications: enriched,
      unreadCount,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 },
    );
  }
}

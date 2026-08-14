import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import Notice from "@/models/Notice";
import Member from "@/models/Member";
import { notifyNoticePosted } from "@/lib/v1/notify";
import { authorize } from "@/lib/rbac/authorize";
// POST /api/notices — Admin creates notice
export async function POST(request) {
  try {
    const gate = await authorize(request, "notice.notice.create");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    const societyId = gate.context.societyId || decoded.societyId;
    const {
      type,
      priority,
      title,
      description,
      pinned,
      expiryOption,
      customExpiryDate,
    } = await request.json();
    // Validation
    const validTypes = [
      "maintenance",
      "meeting",
      "water",
      "electricity",
      "parking",
      "security",
      "event",
      "billing",
      "custom",
    ];
    const validPriorities = ["low", "medium", "high", "urgent"];
    if (!validTypes.includes(type))
      return NextResponse.json(
        { error: "Invalid notice type" },
        { status: 400 },
      );
    if (!validPriorities.includes(priority))
      return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
    if (!title || title.trim().length < 10 || title.trim().length > 150)
      return NextResponse.json(
        { error: "Title must be 10–150 characters" },
        { status: 400 },
      );
    if (
      !description ||
      description.trim().length < 30 ||
      description.trim().length > 2000
    )
      return NextResponse.json(
        { error: "Description must be 30–2000 characters" },
        { status: 400 },
      );
    // Calculate expiry
    let expiresAt = null;
    const now = new Date();
    const expiryMap = { "1d": 1, "3d": 3, "5d": 5, "7d": 7 };
    if (expiryOption && expiryMap[expiryOption]) {
      expiresAt = new Date(
        now.getTime() + expiryMap[expiryOption] * 24 * 60 * 60 * 1000,
      );
    } else if (expiryOption === "custom" && customExpiryDate) {
      const parsed = new Date(customExpiryDate);
      if (isNaN(parsed) || parsed <= now)
        return NextResponse.json(
          { error: "Custom expiry must be a future date" },
          { status: 400 },
        );
      expiresAt = parsed;
    }
    const notice = await Notice.create({
      societyId,
      createdBy: decoded.userId,
      createdByName: decoded.name || "Admin",
      type,
      priority,
      title: title.trim(),
      description: description.trim(),
      pinned: !!pinned,
      expiresAt,
    });
    // Notify all members of society about new notice — creates one
    // Notification row (recipientType "all") + sends FCM to the society.
    // notifyNoticePosted is already non-blocking internally (swallows its own
    // errors), the outer try/catch is belt-and-suspenders.
    try {
      await notifyNoticePosted({
        noticeId: notice._id,
        societyId,
        title: title.trim(),
        createdBy: decoded.userId,
        createdByName: decoded.name || "Admin",
      });
    } catch (notifyErr) {
      console.warn(
        "Notice notification failed (non-blocking):",
        notifyErr.message,
      );
    }
    return NextResponse.json({ success: true, notice }, { status: 201 });
  } catch (error) {
    console.error("Create notice error:", error);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 },
    );
  }
}
// GET /api/notices — List notices (members + admin)
export async function GET(request) {
  try {
    const gate = await authorize(request, "notice.notice.view");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const societyId = gate.context.societyId || decoded.societyId;
    const searchParams = new URL(request.url).searchParams;
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const type = searchParams.get("type");
    const priority = searchParams.get("priority");
    const query = {
      societyId,
      isDeleted: false,
    };
    if (type && type !== "all") query.type = type;
    if (priority && priority !== "all") query.priority = priority;
    // Total member count for view stats — staff hat (any RBAC role that
    // reached this point with notice.notice.view), not a hardcoded legacy
    // role list.
    const isStaffViewer = gate.context.hat === "staff";
    let totalMembers = 0;
    if (isStaffViewer) {
      totalMembers = await Member.countDocuments({ societyId });
    }
    const [notices, total] = await Promise.all([
      Notice.find(query)
        .sort({ pinned: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        // Select viewedBy count but not full array for list view
        .select("-viewedBy -acknowledgedBy")
        .lean(),
      Notice.countDocuments(query),
    ]);
    // For admin: get view counts separately
    let enrichedNotices = notices;
    if (isStaffViewer) {
      const ids = notices.map((n) => n._id);
      const fullNotices = await Notice.find({ _id: { $in: ids } })
        .select("_id viewedBy acknowledgedBy")
        .lean();
      const countMap = {};
      fullNotices.forEach((n) => {
        countMap[n._id.toString()] = {
          viewedCount: n.viewedBy?.length || 0,
          acknowledgedCount: n.acknowledgedBy?.length || 0,
        };
      });
      enrichedNotices = notices.map((n) => ({
        ...n,
        ...countMap[n._id.toString()],
        totalMembers,
      }));
    } else {
      // For members: show whether they personally viewed/acknowledged
      enrichedNotices = notices.map((n) => ({ ...n }));
    }
    return NextResponse.json({
      success: true,
      notices: enrichedNotices,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 },
    );
  }
}

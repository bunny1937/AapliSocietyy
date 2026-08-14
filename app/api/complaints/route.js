import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import { authorize } from "@/lib/rbac/authorize";
import Complaint from "@/models/Complaint";
import {
  generateAnonymousName,
  hasProfanity,
  hasBlockedContent,
  checkRateLimitResult,
} from "@/lib/complaintUtils";
// POST /api/complaints — Member creates a complaint
export async function POST(request) {
  try {
    const gate = await authorize(request, "complaint.complaint.create");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded || decoded.role !== "Member") {
      return NextResponse.json(
        { error: "Only members can submit complaints" },
        { status: 403 },
      );
    }
    const { category, title, description } = await request.json();
    // --- Server-side validation ---
    const validCategories = [
      "noise",
      "parking",
      "water",
      "security",
      "cleanliness",
      "maintenance",
      "billing",
      "staff",
      "pets",
      "other",
    ];
    if (!validCategories.includes(category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }
    if (!title || title.trim().length < 10 || title.trim().length > 120) {
      return NextResponse.json(
        { error: "Title must be between 10 and 120 characters" },
        { status: 400 },
      );
    }
    if (
      !description ||
      description.trim().length < 30 ||
      description.trim().length > 1000
    ) {
      return NextResponse.json(
        { error: "Description must be between 30 and 1000 characters" },
        { status: 400 },
      );
    }
    if (hasProfanity(title) || hasProfanity(description)) {
      return NextResponse.json(
        { error: "Content contains inappropriate language" },
        { status: 400 },
      );
    }
    if (hasBlockedContent(title) || hasBlockedContent(description)) {
      return NextResponse.json(
        { error: "Links, emails, and phone numbers are not allowed" },
        { status: 400 },
      );
    }
    // --- Rate limit check ---
    const recentComplaints = await Complaint.find({
      memberId: decoded.memberId,
      societyId: decoded.societyId,
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("createdAt")
      .lean();
    const rateCheck = checkRateLimitResult(recentComplaints);
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: rateCheck.reason }, { status: 429 });
    }
    const complaint = await Complaint.create({
      societyId: decoded.societyId,
      memberId: decoded.memberId,
      anonymousName: generateAnonymousName(),
      category,
      title: title.trim(),
      description: description.trim(),
      status: "PENDING",
    });
    return NextResponse.json({ success: true, complaint }, { status: 201 });
  } catch (error) {
    console.error("Create complaint error:", error);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 },
    );
  }
}
// GET /api/complaints — Public approved complaints (members + admin)
export async function GET(request) {
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
    const searchParams = new URL(request.url).searchParams;
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const category = searchParams.get("category");
    const query = {
      societyId: decoded.societyId,
      status: "APPROVED",
    };
    if (category && category !== "all") query.category = category;
    const [complaints, total] = await Promise.all([
      Complaint.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        // SECURITY: never return memberId to public
        .select("-memberId -adminRejectionReason -reviewedBy")
        .lean(),
      Complaint.countDocuments(query),
    ]);
    return NextResponse.json({
      success: true,
      complaints,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 },
    );
  }
}

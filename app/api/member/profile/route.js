import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import { authorize } from "@/lib/rbac/authorize";
import Member from "@/models/Member";
import Society from "@/models/Society";
export async function GET(request) {
  try {
    const gate = await authorize(request, "member.profile.viewSelf");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded || !decoded.memberId)
      return NextResponse.json({ error: "Not a member" }, { status: 403 });
    const [member, society] = await Promise.all([
      Member.findOne({
        _id: decoded.memberId,
        societyId: decoded.societyId,
      }).lean(),
      Society.findById(decoded.societyId)
        .select("name address config bankDetails")
        .lean(),
    ]);
    if (!member)
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    // Member is the flat's shared record (owner-level fields at the top
    // level; the tenant's own info lives in member.currentTenant). The page
    // needs to know which side is looking so it can show the caller their
    // OWN identity instead of always defaulting to the owner's.
    return NextResponse.json({
      success: true,
      member,
      society,
      viewerOccupancyType: decoded.occupancyType || "Owner",
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 },
    );
  }
}
export async function PUT(request) {
  try {
    const gate = await authorize(request, "member.profile.updateSelf");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded || !decoded.memberId)
      return NextResponse.json({ error: "Not a member" }, { status: 403 });
    const body = await request.json();
    // Members can only update safe fields
    const allowedFields = [
      "whatsappNumber",
      "alternateContact",
      "emailSecondary",
      "permanentAddress",
      "emergencyContact",
      "billingPreferences",
    ];
    const updates = {};
    allowedFields.forEach((f) => {
      if (body[f] !== undefined) updates[f] = body[f];
    });
    const member = await Member.findByIdAndUpdate(
      decoded.memberId,
      { $set: updates },
      { new: true },
    ).lean();
    return NextResponse.json({ success: true, member });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 },
    );
  }
}

// app/api/visitor/enter/route.js
// PATCH — Security guard admits an Approved visitor (status Approved → Entered).
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import Visitor from "@/models/Visitor";
import Member from "@/models/Member";
import { requireSecurity } from "@/lib/authz";
import { logAudit } from "@/lib/audit-logger";
import { sendInApp } from "@/lib/visitor-channels";
import { authorize } from "@/lib/rbac/authorize";
export async function PATCH(request) {
  const gate = await authorize(request, "visitor.visitor.enter");
  if (!gate.ok) return gate.response;
  const auth = requireSecurity(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { visitorId } = await request.json();
    if (!visitorId || !mongoose.Types.ObjectId.isValid(visitorId))
      return NextResponse.json({ error: "Valid visitorId required" }, { status: 400 });
    // Allow admitting an Approved visit. (Pass entries are already 'Entered'.)
    const visitor = await Visitor.findOneAndUpdate(
      {
        _id: visitorId,
        societyId: auth.user.societyId,
        status: "Approved",
      },
      { status: "Entered", entryTime: new Date() },
      { new: true },
    );
    if (!visitor)
      return NextResponse.json(
        { error: "Visitor not found or not approved yet" },
        { status: 404 },
      );
    const member = await Member.findById(visitor.memberId).select("flatNo wing").lean();
    // Tell the resident the visitor is now inside.
    await sendInApp({
      societyId: auth.user.societyId,
      createdBy: auth.user.userId,
      createdByName: auth.user.name || "Security",
      type: "VISITOR_ENTERED",
      title: "Visitor entered",
      message: `${visitor.name} (${visitor.purpose}) has entered the premises.`,
      recipientType: "member",
      recipientIds: [visitor.memberId.toString()],
      actionUrl: "/member/visitors",
      metadata: { visitorId: visitor._id.toString() },
    });
    await logAudit(auth.user.userId, auth.user.societyId, "VISITOR_ENTERED", null, {
      visitorId: visitor._id.toString(),
      flat: member ? `${member.wing || ""}-${member.flatNo}` : "",
    });
    return NextResponse.json({ success: true, status: visitor.status });
  } catch (err) {
    console.error("Visitor enter error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

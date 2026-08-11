// app/api/visitor/guard-admit/route.js
// PATCH — Guard admits a visitor regardless of approval status (Pending/Approved/Expired).
// Used when guard has verbal confirmation from resident or decides to override.
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import Visitor from "@/models/Visitor";
import Member from "@/models/Member";
import { requireSecurity } from "@/lib/authz";
import { logAudit } from "@/lib/audit-logger";
import { sendInApp } from "@/lib/visitor-channels";
import { stopEscalation } from "@/lib/escalation";
import { authorize } from "@/lib/rbac/authorize";
const ADMITTABLE = ["Pending", "Approved", "Expired"];
export async function PATCH(request) {
  const gate = await authorize(request, "visitor.visitor.guardAdmit");
  if (!gate.ok) return gate.response;
  const auth = requireSecurity(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { visitorId } = await request.json();
    if (!visitorId || !mongoose.Types.ObjectId.isValid(visitorId))
      return NextResponse.json({ error: "Valid visitorId required" }, { status: 400 });
    const visitor = await Visitor.findOne({ _id: visitorId, societyId: auth.user.societyId });
    if (!visitor)
      return NextResponse.json({ error: "Visitor not found" }, { status: 404 });
    if (!ADMITTABLE.includes(visitor.status))
      return NextResponse.json(
        { error: `Cannot admit visitor with status: ${visitor.status}` },
        { status: 409 },
      );
    await stopEscalation(visitor);
    visitor.status = "Entered";
    visitor.entryTime = new Date();
    visitor.approvedBy = auth.user.userId;
    visitor.approvedAt = new Date();
    visitor.approverRole = "Security";
    await visitor.save();
    const member = await Member.findById(visitor.memberId).select("flatNo wing").lean();
    await sendInApp({
      societyId: auth.user.societyId,
      createdBy: auth.user.userId,
      createdByName: auth.user.name || "Security",
      type: "VISITOR_ENTERED",
      title: "Visitor admitted by guard",
      message: `${visitor.name} (${visitor.purpose}) was admitted by the security guard.`,
      recipientType: "member",
      recipientIds: [visitor.memberId.toString()],
      actionUrl: "/member/visitors",
      metadata: { visitorId: visitor._id.toString() },
    });
    await logAudit(auth.user.userId, auth.user.societyId, "VISITOR_GUARD_ADMIT", null, {
      visitorId: visitor._id.toString(),
      flat: member ? `${member.wing || ""}-${member.flatNo}` : "",
      previousStatus: visitor.status,
    });
    return NextResponse.json({ success: true, status: "Entered" });
  } catch (err) {
    console.error("Visitor guard-admit error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

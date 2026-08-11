// app/api/visitor/approve/route.js
// POST — Resident (owner/tenant) approves or rejects a pending visitor.
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import Visitor from "@/models/Visitor";
import Member from "@/models/Member";
import { requireAuth } from "@/lib/authz";
import { logAudit } from "@/lib/audit-logger";
import { notifyGuardDecision } from "@/lib/visitor-notify";
import { stopEscalation } from "@/lib/escalation";
import { authorize } from "@/lib/rbac/authorize";
export async function POST(request) {
  const gate = await authorize(request, "visitor.visitor.approve");
  if (!gate.ok) return gate.response;
  const auth = requireAuth(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { visitorId, action } = await request.json();
    if (!visitorId || !mongoose.Types.ObjectId.isValid(visitorId))
      return NextResponse.json({ error: "Valid visitorId required" }, { status: 400 });
    if (!["approve", "reject"].includes(action))
      return NextResponse.json(
        { error: "action must be 'approve' or 'reject'" },
        { status: 400 },
      );
    // Scope: members may only act on their own flat's visitors.
    const query = { _id: visitorId, societyId: auth.user.societyId };
    const isResident = auth.user.role === "Member";
    if (isResident) {
      if (!auth.user.memberId)
        return NextResponse.json({ error: "Member profile required" }, { status: 403 });
      query.memberId = auth.user.memberId;
    }
    const visitor = await Visitor.findOne(query);
    if (!visitor)
      return NextResponse.json({ error: "Visitor record not found" }, { status: 404 });
    if (visitor.status !== "Pending")
      return NextResponse.json(
        { error: `Visitor already ${visitor.status}` },
        { status: 409 },
      );
    if (visitor.expiresAt && new Date() > visitor.expiresAt)
      return NextResponse.json({ error: "Approval window expired" }, { status: 410 });
    visitor.status = action === "approve" ? "Approved" : "Rejected";
    visitor.approvedBy = auth.user.userId;
    visitor.approvedAt = new Date();
    visitor.approverRole = isResident ? "Resident" : auth.user.role;
    await stopEscalation(visitor);
    await visitor.save();
    const member = await Member.findById(visitor.memberId)
      .select("flatNo wing")
      .lean();
    await notifyGuardDecision({
      societyId: auth.user.societyId,
      actorId: auth.user.userId,
      visitor,
      action,
      member,
    });
    await logAudit(
      auth.user.userId,
      auth.user.societyId,
      action === "approve" ? "VISITOR_APPROVED" : "VISITOR_REJECTED",
      null,
      { visitorId: visitor._id.toString(), name: visitor.name },
    );
    return NextResponse.json({ success: true, status: visitor.status });
  } catch (err) {
    console.error("Visitor approve error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// app/api/visitor/extend/route.js
// PATCH — Guard extends approval window and re-notifies resident.
// Works on Pending or Expired visitors.
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import Visitor from "@/models/Visitor";
import Member from "@/models/Member";
import Society from "@/models/Society";
import { requireSecurity } from "@/lib/authz";
import { logAudit } from "@/lib/audit-logger";
import { notifyVisitorApproval } from "@/lib/visitor-notify";
import { APPROVAL_WINDOW_MS } from "@/lib/visitor-config";
import { authorize } from "@/lib/rbac/authorize";
export async function PATCH(request) {
  const gate = await authorize(request, "visitor.visitor.extend");
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
    if (!["Pending", "Expired"].includes(visitor.status))
      return NextResponse.json(
        { error: `Cannot extend visitor with status: ${visitor.status}` },
        { status: 409 },
      );
    const newExpiry = new Date(Date.now() + APPROVAL_WINDOW_MS);
    visitor.status = "Pending";
    visitor.expiresAt = newExpiry;
    // Reset escalation so resident gets a fresh notification
    visitor.escalation = {
      level: 0,
      stopped: false,
      lastNotifiedAt: new Date(),
      history: visitor.escalation?.history || [],
    };
    await visitor.save();
    // Re-notify resident
    const [member, society] = await Promise.all([
      Member.findById(visitor.memberId).lean(),
      Society.findById(auth.user.societyId).select("name").lean(),
    ]);
    if (member) {
      await notifyVisitorApproval({
        society: society || { _id: auth.user.societyId },
        member,
        visitor,
        guard: { name: auth.user.name || "Security", phone: auth.user.phone || "" },
      });
    }
    await logAudit(auth.user.userId, auth.user.societyId, "VISITOR_EXTENDED", null, {
      visitorId: visitor._id.toString(),
      newExpiry: newExpiry.toISOString(),
    });
    return NextResponse.json({ success: true, expiresAt: newExpiry });
  } catch (err) {
    console.error("Visitor extend error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

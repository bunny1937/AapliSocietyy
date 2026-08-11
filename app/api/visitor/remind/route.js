// app/api/visitor/remind/route.js
// PATCH — Guard re-sends the approval request to the resident across EVERY
// channel (in-app + push + WhatsApp + SMS + email) in the background.
//
// This is the "one tap, the backend does the rest" replacement for the old
// wa.me deep-link flow. The guard does NOT open WhatsApp, pick a chat, or type
// anything. They tap "Remind" and we tell them which channels actually went out.
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import Visitor from "@/models/Visitor";
import Member from "@/models/Member";
import Society from "@/models/Society";
import { requireSecurity } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
import { logAudit } from "@/lib/audit-logger";
import { notifyVisitorApproval } from "@/lib/visitor-notify";
import { APPROVAL_WINDOW_MS } from "@/lib/visitor-config";
const REMINDABLE = ["Pending", "Expired"];
const CHANNEL_LABEL = {
  in_app: "app",
  push: "push",
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "email",
};
export async function PATCH(request) {
  const gate = await authorize(request, "visitor.visitor.view");
  if (!gate.ok) return gate.response;
  const auth = requireSecurity(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { visitorId } = await request.json();
    if (!visitorId || !mongoose.Types.ObjectId.isValid(visitorId))
      return NextResponse.json({ error: "Valid visitorId required" }, { status: 400 });
    const visitor = await Visitor.findOne({
      _id: visitorId,
      societyId: auth.user.societyId,
    });
    if (!visitor)
      return NextResponse.json({ error: "Visitor not found" }, { status: 404 });
    if (!REMINDABLE.includes(visitor.status))
      return NextResponse.json(
        { error: `This visitor is already ${visitor.status} — nothing to remind.` },
        { status: 409 },
      );
    // Keep the request alive: refresh the approval window and reset the
    // escalation ladder so the resident gets a clean, full notification wave.
    const newExpiry = new Date(Date.now() + APPROVAL_WINDOW_MS);
    visitor.status = "Pending";
    visitor.expiresAt = newExpiry;
    visitor.escalation = {
      level: 0,
      stopped: false,
      lastNotifiedAt: new Date(),
      history: visitor.escalation?.history || [],
    };
    const [member, society] = await Promise.all([
      Member.findById(visitor.memberId).lean(),
      Society.findById(auth.user.societyId).select("name").lean(),
    ]);
    if (!member)
      return NextResponse.json(
        { error: "Flat not found for this visitor" },
        { status: 404 },
      );
    // Fire all channels. notifyVisitorApproval never throws — failed channels
    // simply fall through, so the guard always gets a usable result.
    const result = await notifyVisitorApproval({
      society: society || { _id: auth.user.societyId },
      member,
      visitor,
      guard: { name: auth.user.name || "Security", phone: auth.user.phone || "" },
    });
    if (result.steps?.length) visitor.escalation.history.push(...result.steps);
    await visitor.save();
    // De-duplicated list of channels that actually delivered — drives the toast.
    const delivered = [
      ...new Set(
        (result.steps || [])
          .filter((s) => s.ok && CHANNEL_LABEL[s.channel])
          .map((s) => CHANNEL_LABEL[s.channel]),
      ),
    ];
    await logAudit(auth.user.userId, auth.user.societyId, "VISITOR_REMINDED", null, {
      visitorId: visitor._id.toString(),
      delivered,
    });
    return NextResponse.json({
      success: true,
      reachable: result.anyReachable,
      delivered,
      expiresAt: newExpiry,
    });
  } catch (err) {
    console.error("Visitor remind error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

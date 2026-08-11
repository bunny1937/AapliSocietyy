// app/api/visitor/confirm-entry/route.js
// Resident confirms (or flags) a visitor the guard logged via offline entry.
// Flagging raises a HIGH-priority alert back to the gate so security can verify.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Visitor from "@/models/Visitor";
import Member from "@/models/Member";
import { requireAuth } from "@/lib/authz";
import { logAudit } from "@/lib/audit-logger";
import { sendInApp } from "@/lib/visitor-channels";
import { authorize } from "@/lib/rbac/authorize";
export async function PATCH(request) {
  const gate = await authorize(request, "visitor.visitor.enter");
  if (!gate.ok) return gate.response;
  const auth = requireAuth(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const body = await request.json();
    const visitorId = String(body.visitorId || "").trim();
    const decision = String(body.decision || "").trim(); // acknowledge | flag
    if (!visitorId || !["acknowledge", "flag"].includes(decision)) {
      return NextResponse.json(
        { error: "visitorId and a valid decision are required" },
        { status: 400 },
      );
    }
    // Only the resident of that flat can confirm their own visitor.
    const visitor = await Visitor.findOne({
      _id: visitorId,
      societyId: auth.user.societyId,
      memberId: auth.user.memberId,
    });
    if (!visitor) {
      return NextResponse.json({ error: "Visitor not found" }, { status: 404 });
    }
    if (visitor.entryMethod !== "OfflineEntry") {
      return NextResponse.json({ error: "Not an offline entry" }, { status: 400 });
    }
    const status = decision === "acknowledge" ? "Acknowledged" : "Flagged";
    visitor.offlineMeta = visitor.offlineMeta || {};
    visitor.offlineMeta.confirmation = {
      status,
      at: new Date(),
      by: auth.user.userId,
    };
    await visitor.save();
    // Flag => HIGH alert to the gate/security so they can verify immediately.
    if (decision === "flag") {
      try {
        const member = await Member.findById(visitor.memberId)
          .select("flatNo wing")
          .lean();
        const label = member
          ? member.wing
            ? member.wing + "-" + member.flatNo
            : member.flatNo
          : "";
        await sendInApp({
          societyId: auth.user.societyId,
          createdBy: auth.user.userId,
          createdByName: "Resident",
          type: "VISITOR_FLAGGED",
          title: "\uD83D\uDEA8 Resident flagged an entry — " + label,
          message:
            visitor.name +
            " (" +
            visitor.purpose +
            ") was flagged as NOT recognised. Please verify at the gate.",
          priority: "high",
          recipientType: "role",
          recipientIds: ["Security"],
          actionUrl: "/security/dashboard",
          metadata: { visitorId: String(visitor._id), flat: label },
        });
      } catch (e) {
        console.error("flag alert error", e && e.message);
      }
    }
    await logAudit(
      auth.user.userId,
      auth.user.societyId,
      decision === "flag" ? "VISITOR_ENTRY_FLAGGED" : "VISITOR_ENTRY_CONFIRMED",
      null,
      { id: String(visitor._id), decision: status },
    );
    return NextResponse.json({
      success: true,
      confirmation: visitor.offlineMeta.confirmation,
    });
  } catch (err) {
    console.error("confirm-entry error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

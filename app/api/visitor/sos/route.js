// app/api/visitor/sos/route.js
// POST — Panic / SOS. Raisable by a guard or a resident.
// Broadcasts a CRITICAL alert to all guards + admins (and optionally the flat).
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Visitor from "@/models/Visitor";
import { requireAuth } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
import { logAudit } from "@/lib/audit-logger";
import { sendInApp } from "@/lib/visitor-channels";
export async function POST(request) {
  const gate = await authorize(request, "visitor.visitor.sos");
  if (!gate.ok) return gate.response;
  const auth = requireAuth(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const body = await request.json().catch(() => ({}));
    const note = String(body.note || "").trim().slice(0, 300);
    const gateLabel = auth.user.gateLabel || body.gateLabel || "";
    const raisedByRole = auth.user.role === "Security" ? "Guard" : auth.user.role;
    // Optional: attach to a visitor record for context.
    let visitorRef = null;
    if (body.visitorId) {
      visitorRef = await Visitor.findOne({
        _id: body.visitorId,
        societyId: auth.user.societyId,
      })
        .select("name purpose")
        .lean();
    }
    const message =
      `🚨 SOS raised by ${auth.user.name || raisedByRole}` +
      (gateLabel ? ` at ${gateLabel}` : "") +
      (note ? ` — ${note}` : "") +
      (visitorRef ? ` (re: ${visitorRef.name})` : "");
    // Critical alert to security + admins simultaneously.
    await sendInApp({
      societyId: auth.user.societyId,
      createdBy: auth.user.userId,
      createdByName: auth.user.name || raisedByRole,
      type: "VISITOR_SOS",
      title: "🚨 EMERGENCY — SOS",
      message,
      priority: "critical",
      recipientType: "role",
      recipientIds: ["Security", "Admin", "Secretary"],
      actionUrl: "/security/dashboard",
      metadata: {
        raisedBy: auth.user.userId,
        raisedByRole,
        gateLabel,
        note,
        visitorId: body.visitorId || null,
      },
    });
    await logAudit(auth.user.userId, auth.user.societyId, "VISITOR_SOS", null, {
      gateLabel,
      note,
      raisedByRole,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("SOS error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

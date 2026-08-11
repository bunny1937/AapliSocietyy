// app/api/visitor/pass/verify/route.js
// POST — Security guard verifies a pass (OTP or QR token) at the gate.
// On success, creates an Entered visit (entryMethod 'Pass') and notifies the flat.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import VisitorPass from "@/models/VisitorPass";
import Visitor from "@/models/Visitor";
import Member from "@/models/Member";
import cache from "@/lib/cache";
import { requireSecurity } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
import { logAudit } from "@/lib/audit-logger";
import { sendInApp } from "@/lib/visitor-channels";
const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 300;
export async function POST(request) {
  const gate = await authorize(request, "visitor.pass.verify");
  if (!gate.ok) return gate.response;
  const auth = requireSecurity(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const body = await request.json();
    const otp = String(body.otp || "").trim();
    const qrToken = String(body.qrToken || "").trim();
    if (!otp && !qrToken)
      return NextResponse.json({ error: "Provide an OTP or QR token" }, { status: 400 });
    // ---- Brute-force throttle (per guard) ----
    const rlKey = `pass-verify:${auth.user.societyId}:${auth.user.userId}`;
    try {
      const attempts = (await cache.get(rlKey)) || 0;
      if (attempts >= MAX_ATTEMPTS)
        return NextResponse.json(
          { error: "Too many attempts. Try again shortly." },
          { status: 429 },
        );
      await cache.set(rlKey, attempts + 1, WINDOW_SECONDS);
    } catch (_) {
      // cache optional — do not block verification if Redis is down
    }
    // ---- Locate candidate pass by hashed credential (society-scoped) ----
    const hash = VisitorPass.hashCredential(otp || qrToken);
    const credField = otp ? "otpHash" : "qrTokenHash";
    const pass = await VisitorPass.findOne({
      societyId: auth.user.societyId,
      status: "Active",
      [credField]: hash,
    });
    if (!pass)
      return NextResponse.json(
        { error: "Invalid or expired pass" },
        { status: 404 },
      );
    // ---- Validate usability (window + recurrence + uses) ----
    if (!pass.isUsableNow()) {
      // Reflect terminal state if the window has fully closed.
      if (new Date() > pass.expiresAt && pass.status === "Active") {
        pass.status = "Expired";
        await pass.save();
      }
      return NextResponse.json(
        { error: "Pass is not valid at this time" },
        { status: 403 },
      );
    }
    // ---- Consume one use ----
    pass.usedAt.push(new Date());
    if (pass.maxUses > 0 && pass.usedAt.length >= pass.maxUses) pass.status = "Used";
    await pass.save();
    // ---- Create the (already-approved) Entered visit ----
    const visitor = await Visitor.create({
      societyId: auth.user.societyId,
      memberId: pass.memberId,
      name: pass.visitorName,
      phone: pass.visitorPhone || "",
      photo: pass.visitorPhoto || "",
      vehicleNumber: pass.vehicleNumber || "",
      purpose: pass.purpose,
      status: "Entered",
      entryMethod: "Pass",
      passId: pass._id,
      entryTime: new Date(),
      enteredBy: auth.user.userId,
      gateLabel: auth.user.gateLabel || "Main Gate",
      approvedBy: pass.createdBy,
      approvedAt: new Date(),
      approverRole: "Pass",
      escalation: { level: 0, stopped: true, lastNotifiedAt: null, history: [] },
    });
    const member = await Member.findById(pass.memberId).select("flatNo wing").lean();
    await sendInApp({
      societyId: auth.user.societyId,
      createdBy: auth.user.userId,
      createdByName: auth.user.name || "Security",
      type: "VISITOR_PASS",
      title: "Pass used — visitor entered",
      message: `${pass.visitorName} (${pass.purpose}) entered using a ${pass.passType} pass.`,
      recipientType: "member",
      recipientIds: [pass.memberId.toString()],
      actionUrl: "/member/visitors",
      metadata: { visitorId: visitor._id.toString(), passId: pass._id.toString() },
    });
    await logAudit(auth.user.userId, auth.user.societyId, "VISITOR_PASS_VERIFIED", null, {
      passId: pass._id.toString(),
      visitorId: visitor._id.toString(),
      method: otp ? "OTP" : "QR",
    });
    return NextResponse.json({
      success: true,
      visitor: {
        id: visitor._id,
        name: visitor.name,
        purpose: visitor.purpose,
        photo: visitor.photo,
        flat: member ? `${member.wing || ""}-${member.flatNo}` : "",
        passType: pass.passType,
      },
    });
  } catch (err) {
    console.error("Pass verify error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

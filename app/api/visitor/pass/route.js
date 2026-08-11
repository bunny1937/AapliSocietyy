// app/api/visitor/pass/route.js
// POST — Resident creates a pre-approved pass (OTP + QR).
// GET  — Resident lists their passes.
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import VisitorPass from "@/models/VisitorPass";
import { requireAuth } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
import { logAudit } from "@/lib/audit-logger";
import {
  isValidPurpose,
  isSafePhotoValue,
  PASS_MAX_USES_CAP,
} from "@/lib/visitor-config";
function resolveMemberId(auth, bodyMemberId) {
  // Residents always issue passes for their own flat. Admin/Security may pass one.
  if (auth.user.role === "Member") return auth.user.memberId;
  return bodyMemberId;
}
export async function POST(request) {
  const gate = await authorize(request, "visitor.pass.create");
  if (!gate.ok) return gate.response;
  const auth = requireAuth(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const body = await request.json();
    const memberId = resolveMemberId(auth, body.memberId);
    const visitorName = String(body.visitorName || "").trim();
    const purpose = String(body.purpose || "Guest").trim();
    const passType = ["OneTime", "Recurring", "Frequent"].includes(body.passType)
      ? body.passType
      : "OneTime";
    if (!memberId || !mongoose.Types.ObjectId.isValid(String(memberId)))
      return NextResponse.json({ error: "Valid memberId required" }, { status: 400 });
    if (!visitorName)
      return NextResponse.json({ error: "visitorName is required" }, { status: 400 });
    if (!isValidPurpose(purpose))
      return NextResponse.json({ error: "Invalid purpose" }, { status: 400 });
    if (!isSafePhotoValue(body.visitorPhoto))
      return NextResponse.json(
        { error: "visitorPhoto must be an uploaded URL" },
        { status: 400 },
      );
    const validFrom = new Date(body.validFrom);
    const expiresAt = new Date(body.expiresAt);
    if (isNaN(validFrom) || isNaN(expiresAt))
      return NextResponse.json({ error: "Invalid validFrom/expiresAt" }, { status: 400 });
    if (expiresAt <= validFrom)
      return NextResponse.json(
        { error: "expiresAt must be after validFrom" },
        { status: 400 },
      );
    if (expiresAt <= new Date())
      return NextResponse.json({ error: "expiresAt is in the past" }, { status: 400 });
    let maxUses = body.maxUses ?? (passType === "OneTime" ? 1 : 0);
    if (maxUses < 0 || maxUses > PASS_MAX_USES_CAP)
      return NextResponse.json(
        { error: `maxUses must be between 0 and ${PASS_MAX_USES_CAP}` },
        { status: 400 },
      );
    let recurrence = null;
    if (passType === "Recurring") {
      const days = Array.isArray(body.recurrence?.days)
        ? body.recurrence.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        : [];
      recurrence = {
        days,
        startTime: body.recurrence?.startTime || "00:00",
        endTime: body.recurrence?.endTime || "23:59",
      };
    }
    const { otp, otpHash } = VisitorPass.generateOTP();
    const { token: qrToken, qrTokenHash } = VisitorPass.generateQRToken();
    const pass = await VisitorPass.create({
      societyId: auth.user.societyId,
      memberId,
      createdBy: auth.user.userId,
      visitorName,
      visitorPhone: String(body.visitorPhone || "").trim(),
      visitorPhoto: body.visitorPhoto || null,
      vehicleNumber: String(body.vehicleNumber || "").trim(),
      purpose,
      note: String(body.note || "").trim(),
      passType,
      recurrence,
      validFrom,
      expiresAt,
      maxUses,
      otpHash,
      qrTokenHash,
      status: "Active",
    });
    await logAudit(auth.user.userId, auth.user.societyId, "VISITOR_PASS_CREATED", null, {
      passId: pass._id.toString(),
      visitorName,
      passType,
    });
    // Raw OTP + QR token returned exactly once — never stored in plaintext.
    return NextResponse.json({
      success: true,
      passId: pass._id,
      otp,
      qrToken,
      expiresAt: pass.expiresAt,
    });
  } catch (err) {
    console.error("Visitor pass create error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
export async function GET(request) {
  const gate = await authorize(request, "visitor.pass.view");
  if (!gate.ok) return gate.response;
  const auth = requireAuth(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const query = { societyId: auth.user.societyId };
    if (auth.user.role === "Member") {
      if (!auth.user.memberId)
        return NextResponse.json({ error: "Member profile required" }, { status: 400 });
      query.memberId = auth.user.memberId;
    } else if (searchParams.get("memberId")) {
      query.memberId = searchParams.get("memberId");
    }
    const passes = await VisitorPass.find(query)
      .sort({ createdAt: -1 })
      .limit(50)
      .select("-otpHash -qrTokenHash") // never leak secrets in listings
      .lean();
    return NextResponse.json({ success: true, passes });
  } catch (err) {
    console.error("Visitor pass list error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

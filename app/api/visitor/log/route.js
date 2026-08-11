// app/api/visitor/log/route.js
// POST — Security guard logs a new visitor and requests resident approval.
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import Visitor from "@/models/Visitor";
import Member from "@/models/Member";
import { requireSecurity } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
import { logAudit } from "@/lib/audit-logger";
import { checkBlacklist } from "@/lib/blacklist";
import { notifyVisitorApproval } from "@/lib/visitor-notify";
import {
  APPROVAL_WINDOW_MS,
  isValidPurpose,
  isSafePhotoValue,
} from "@/lib/visitor-config";
export async function POST(request) {
  const gate = await authorize(request, "visitor.visitor.enter");
  if (!gate.ok) return gate.response;
  const auth = requireSecurity(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const body = await request.json();
    const memberId = String(body.memberId || body.flatId || "").trim();
    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").trim();
    const photo = String(body.photo || "").trim();
    const purpose = String(body.purpose || "").trim();
    const purposeNote = String(body.purposeNote || "").trim();
    const vehicleNumber = String(body.vehicleNumber || "").trim();
    const linkedComplaintId = body.linkedComplaintId || null;
    // ---- Validation ----
    if (!memberId || !name || !purpose)
      return NextResponse.json(
        { error: "memberId, name and purpose are required" },
        { status: 400 },
      );
    if (!mongoose.Types.ObjectId.isValid(memberId))
      return NextResponse.json({ error: "Invalid memberId" }, { status: 400 });
    if (!isValidPurpose(purpose))
      return NextResponse.json({ error: "Invalid purpose" }, { status: 400 });
    if (!isSafePhotoValue(photo))
      return NextResponse.json(
        { error: "photo must be an uploaded URL, not base64" },
        { status: 400 },
      );
    if (name.length > 100)
      return NextResponse.json({ error: "name too long" }, { status: 400 });
    // ---- Resolve flat (society-scoped) ----
    const member = await Member.findOne({
      _id: memberId,
      societyId: auth.user.societyId,
      isDeleted: { $ne: true },
    })
      .select(
        "flatNo wing ownerName ownershipType currentTenant contactNumber whatsappNumber alternateContact emailPrimary emailSecondary contactInvalid",
      )
      .lean();
    if (!member)
      return NextResponse.json({ error: "Flat not found" }, { status: 404 });
    // ---- Watchlist check ----
    const hit = await checkBlacklist({
      societyId: auth.user.societyId,
      phone,
      name,
    });
    if (hit && hit.severity === "block") {
      await logAudit(auth.user.userId, auth.user.societyId, "VISITOR_REJECTED", null, {
        name,
        phone,
        reason: `Blocked by watchlist: ${hit.reason}`,
      });
      return NextResponse.json(
        {
          error: "This visitor is on the society block list and cannot be admitted.",
          blocked: true,
          reason: hit.reason,
        },
        { status: 403 },
      );
    }
    // ---- Create the pending visit ----
    const now = new Date();
    const visitor = await Visitor.create({
      societyId: auth.user.societyId,
      memberId: member._id,
      name,
      phone,
      photo,
      vehicleNumber,
      purpose,
      purposeNote,
      status: "Pending",
      entryMethod: "Manual",
      entryTime: now,
      expiresAt: new Date(now.getTime() + APPROVAL_WINDOW_MS),
      enteredBy: auth.user.userId,
      gateLabel: auth.user.gateLabel || "Main Gate",
      linkedComplaintId,
      isBlacklisted: !!hit,
      blacklistReason: hit ? hit.reason : "",
      escalation: { level: 0, stopped: false, lastNotifiedAt: now, history: [] },
    });
    // ---- Fire the first notification wave (owner + tenant, multi-channel) ----
    const notifyResult = await notifyVisitorApproval({
      society: { _id: auth.user.societyId },
      member: { ...member, _id: member._id },
      visitor,
      guard: { name: auth.user.name, phone: auth.user.phone || "" },
    });
    // Persist the first-wave delivery log on the visit for the audit trail.
    if (notifyResult.steps?.length) {
      visitor.escalation.history.push(...notifyResult.steps);
      await visitor.save();
    }
    await logAudit(auth.user.userId, auth.user.societyId, "VISITOR_CREATED", null, {
      id: visitor._id.toString(),
      memberId: member._id.toString(),
      flatNo: member.flatNo,
      wing: member.wing,
      name: visitor.name,
      purpose: visitor.purpose,
      status: visitor.status,
      gateLabel: visitor.gateLabel,
      blacklisted: !!hit,
    });
    return NextResponse.json({
      success: true,
      visitorId: visitor._id,
      status: visitor.status,
      expiresAt: visitor.expiresAt,
      watchlist: hit ? { severity: hit.severity, reason: hit.reason } : null,
      delivery: {
        reachable: notifyResult.anyReachable,
        channels: notifyResult.channelsTried,
      },
    });
  } catch (err) {
    console.error("Visitor log error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

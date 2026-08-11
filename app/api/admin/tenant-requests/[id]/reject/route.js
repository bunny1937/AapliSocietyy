// POST /api/admin/tenant-requests/:id/reject  { reason: string }
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import TenantRequest from "@/models/TenantRequest";
import Member from "@/models/Member";
import { requireRoles } from "@/lib/authz";
import { logAudit } from "@/lib/audit-logger";
import { buildTenantDecisionNotification } from "@/lib/tenant-notifications";
import { sendInApp } from "@/lib/visitor-channels";
import { authorize } from "@/lib/rbac/authorize";
export async function POST(request, { params }) {
  const gate = await authorize(request, "member.tenantRequest.reject");
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!mongoose.Types.ObjectId.isValid(id))
    return NextResponse.json({ error: "Valid id required" }, { status: 400 });
  try {
    await connectDB();
    const body = await request.json().catch(() => ({}));
    const reason = String(body.reason || "").trim();
    const tenantRequest = await TenantRequest.findOne({
      _id: id,
      societyId: gate.context.societyId,
      status: "Pending",
    });
    if (!tenantRequest)
      return NextResponse.json({ error: "No pending request found for that id" }, { status: 404 });
    const member = await Member.findOne({ _id: tenantRequest.memberId, societyId: gate.context.societyId }).lean();
    tenantRequest.status = "Rejected";
    tenantRequest.rejectionReason = reason || undefined;
    await tenantRequest.save();
    const notif = buildTenantDecisionNotification({
      decision: "rejected",
      tenantName: tenantRequest.tenantName,
      flatNo: member?.flatNo || "your flat",
      rejectionReason: reason || undefined,
    });
    await sendInApp({
      societyId: gate.context.societyId,
      createdBy: gate.context.userId,
      createdByName: "Admin",
      type: notif.type,
      title: notif.title,
      message: notif.message,
      recipientType: "member",
      // The flat's Member._id — not requestedByUserId (a User._id). Every
      // other recipientType:"member" emitter in this app (see
      // app/api/visitor/enter, GET /api/notifications's own query) matches
      // against memberId; using the owner's userId here meant this
      // notification could never actually be seen, on web or mobile.
      recipientIds: [String(tenantRequest.memberId)],
      metadata: { tenantRequestId: String(tenantRequest._id) },
    });
    await logAudit(gate.context.userId, gate.context.societyId, "TENANT_REQUEST_REJECTED", null, {
      tenantRequestId: String(tenantRequest._id),
      reason,
    });
    return NextResponse.json({ success: true, tenantRequest });
  } catch (err) {
    console.error("Tenant request reject error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

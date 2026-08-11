// POST /api/admin/profile-edit-requests/:id/reject  { reason: string }
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import ProfileEditRequest from "@/models/ProfileEditRequest";
import Member from "@/models/Member";
import { requireRoles } from "@/lib/authz";
import { logAudit } from "@/lib/audit-logger";
import { buildProfileEditDecisionNotification } from "@/lib/profile-edit-notifications";
import { sendInApp } from "@/lib/visitor-channels";
import { authorize } from "@/lib/rbac/authorize";
export async function POST(request, { params }) {
  const gate = await authorize(request, "member.profileEditRequest.reject");
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!mongoose.Types.ObjectId.isValid(id))
    return NextResponse.json({ error: "Valid id required" }, { status: 400 });
  try {
    await connectDB();
    const body = await request.json().catch(() => ({}));
    const reason = String(body.reason || "").trim();
    const editRequest = await ProfileEditRequest.findOne({
      _id: id,
      societyId: gate.context.societyId,
      status: "Pending",
    });
    if (!editRequest)
      return NextResponse.json({ error: "No pending request found for that id" }, { status: 404 });
    const member = editRequest.shopId
      ? null
      : await Member.findOne({ _id: editRequest.memberId, societyId: gate.context.societyId }).lean();
    editRequest.status = "Rejected";
    editRequest.rejectionReason = reason || undefined;
    await editRequest.save();
    const notif = buildProfileEditDecisionNotification({
      decision: "rejected",
      section: editRequest.section,
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
      recipientType: editRequest.shopId ? "user" : "member",
      recipientIds: [String(editRequest.shopId ? editRequest.requestedByUserId : editRequest.memberId)],
      metadata: { profileEditRequestId: String(editRequest._id) },
    });
    await logAudit(gate.context.userId, gate.context.societyId, "PROFILE_EDIT_REQUEST_REJECTED", null, {
      profileEditRequestId: String(editRequest._id),
      reason,
    });
    return NextResponse.json({ success: true, profileEditRequest: editRequest });
  } catch (err) {
    console.error("Profile edit request reject error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

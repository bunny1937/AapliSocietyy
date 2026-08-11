// POST /api/admin/tenant-requests/:id/approve
// 1. Creates the tenant's User login (temp password, mustChangePassword-style
//    forced first login is enforced on the mobile-backend side, matching how
//    every other login there already works — see that plan's Task 7).
// 2. Calls the flat's Member.addNewTenant() (already implemented, unused
//    elsewhere) to record the tenancy on the canonical Member document.
// 3. Marks the request Approved and notifies the owner.
// 4. Emails the tenant's temp password via the existing sendEmail adapter.
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import connectDB from "@/lib/mongodb";
import TenantRequest from "@/models/TenantRequest";
import Member from "@/models/Member";
import Society from "@/models/Society";
import User from "@/models/User";
import { requireRoles } from "@/lib/authz";
import { logAudit } from "@/lib/audit-logger";
import { generateTenantUsername } from "@/lib/tenant-username";
import { buildTenantDecisionNotification } from "@/lib/tenant-notifications";
import { sendInApp, sendEmail } from "@/lib/visitor-channels";
import { authorize } from "@/lib/rbac/authorize";
function generateTempPassword() {
  return crypto.randomBytes(8).toString("hex");
}
export async function POST(request, { params }) {
  const gate = await authorize(request, "member.tenantRequest.approve");
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!mongoose.Types.ObjectId.isValid(id))
    return NextResponse.json({ error: "Valid id required" }, { status: 400 });
  try {
    await connectDB();
    const tenantRequest = await TenantRequest.findOne({
      _id: id,
      societyId: gate.context.societyId,
      status: "Pending",
    });
    if (!tenantRequest)
      return NextResponse.json({ error: "No pending request found for that id" }, { status: 404 });
    const member = await Member.findOne({ _id: tenantRequest.memberId, societyId: gate.context.societyId });
    if (!member) return NextResponse.json({ error: "Flat not found" }, { status: 404 });
    // Member has no societyName field of its own — look the real name up on
    // Society rather than leaving the tenant's profile.societyName blank.
    const society = await Society.findById(member.societyId).select("name").lean();
    // Ensure a unique username, trying phone-derived base then numeric suffixes.
    const base = generateTenantUsername(tenantRequest.tenantPhone);
    let username = base;
    let suffix = 1;
    while (await User.findOne({ username })) {
      username = `${base}.${suffix}`;
      suffix += 1;
    }
    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const tenantUser = await User.create({
      name: tenantRequest.tenantName,
      username,
      email: tenantRequest.tenantEmail,
      phone: tenantRequest.tenantPhone,
      password: passwordHash,
      role: "Member",
      profiles: [
        {
          societyId: member.societyId,
          memberId: member._id,
          role: "Member",
          occupancyType: "Tenant",
          flatNo: member.flatNo,
          wing: member.wing,
          societyName: society?.name || "",
          isPrimary: true,
          status: "Active",
        },
      ],
      isActive: true,
      mustChangePassword: true,
    });
    member.addNewTenant({
      name: tenantRequest.tenantName,
      contactNumber: tenantRequest.tenantPhone,
      email: tenantRequest.tenantEmail,
      startDate: tenantRequest.leaseStartDate,
      endDate: tenantRequest.leaseEndDate,
      depositAmount: tenantRequest.depositAmount,
      rentPerMonth: tenantRequest.rentPerMonth,
    });
    await member.save();
    tenantRequest.status = "Approved";
    tenantRequest.approvedBy = gate.context.userId;
    tenantRequest.approvedAt = new Date();
    await tenantRequest.save();
    const notif = buildTenantDecisionNotification({
      decision: "approved",
      tenantName: tenantRequest.tenantName,
      flatNo: member.flatNo,
    });
    await sendInApp({
      societyId: gate.context.societyId,
      createdBy: gate.context.userId,
      createdByName: "Admin",
      type: notif.type,
      title: notif.title,
      message: notif.message,
      recipientType: "member",
      // The flat's Member._id — not requestedByUserId (a User._id). See the
      // matching fix in the reject route for why.
      recipientIds: [String(member._id)],
      metadata: { tenantRequestId: String(tenantRequest._id) },
    });
    const emailResult = await sendEmail({
      to: tenantRequest.tenantEmail,
      subject: "Your AapliSociety login",
      text: `Welcome! Your username is ${username} and your temporary password is ${tempPassword}. You'll be asked to change it on first login.`,
    });
    await logAudit(gate.context.userId, gate.context.societyId, "TENANT_REQUEST_APPROVED", null, {
      tenantRequestId: String(tenantRequest._id),
      memberId: String(member._id),
      tenantUserId: String(tenantUser._id),
      emailDelivered: emailResult.ok,
    });
    return NextResponse.json({
      success: true,
      tenantRequest,
      username,
      emailDelivered: emailResult.ok,
    });
  } catch (err) {
    console.error("Tenant request approve error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
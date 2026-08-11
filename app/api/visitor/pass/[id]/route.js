// app/api/visitor/pass/[id]/route.js
// DELETE — Resident (owner) revokes a pass they created.
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import VisitorPass from "@/models/VisitorPass";
import { requireAuth } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
import { logAudit } from "@/lib/audit-logger";
export async function DELETE(request, { params }) {
  const gate = await authorize(request, "visitor.pass.delete");
  if (!gate.ok) return gate.response;
  const auth = requireAuth(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { id } = await params;
    if (!id || !mongoose.Types.ObjectId.isValid(id))
      return NextResponse.json({ error: "Valid pass id required" }, { status: 400 });
    const query = { _id: id, societyId: auth.user.societyId };
    // Residents can only revoke passes for their own flat.
    if (auth.user.role === "Member") query.memberId = auth.user.memberId;
    const pass = await VisitorPass.findOne(query);
    if (!pass)
      return NextResponse.json({ error: "Pass not found" }, { status: 404 });
    if (pass.status === "Revoked")
      return NextResponse.json({ success: true, status: "Revoked" });
    pass.status = "Revoked";
    pass.revokedBy = auth.user.userId;
    pass.revokedAt = new Date();
    await pass.save();
    await logAudit(auth.user.userId, auth.user.societyId, "VISITOR_PASS_REVOKED", null, {
      passId: pass._id.toString(),
    });
    return NextResponse.json({ success: true, status: "Revoked" });
  } catch (err) {
    console.error("Pass revoke error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET /api/admin/tenant-requests/:id/documents/:field
// field is one of contract|signature|aadhaar|policeVerification. Returns a
// short-lived presigned R2 download URL — the admin's browser fetches the
// file directly from R2, this route never buffers it.
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import TenantRequest from "@/models/TenantRequest";
import { requireRoles } from "@/lib/authz";
import { presignTenantDocumentDownload } from "@/lib/tenant-storage";
import { authorize } from "@/lib/rbac/authorize";
const FIELD_TO_KEY = {
  contract: "contractKey",
  signature: "signatureKey",
  aadhaar: "aadhaarKey",
  policeVerification: "policeVerificationKey",
};
export async function GET(request, { params }) {
  const gate = await authorize(request, "member.tenantRequest.view");
  if (!gate.ok) return gate.response;
  const { id, field } = await params;
  const keyField = FIELD_TO_KEY[field];
  if (!keyField) return NextResponse.json({ error: "Unknown document field" }, { status: 400 });
  if (!mongoose.Types.ObjectId.isValid(id))
    return NextResponse.json({ error: "Valid id required" }, { status: 400 });
  try {
    await connectDB();
    const tenantRequest = await TenantRequest.findOne({
      _id: id,
      societyId: gate.context.societyId,
    }).lean();
    if (!tenantRequest) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const key = tenantRequest.documents?.[keyField];
    if (!key) return NextResponse.json({ error: "Document not uploaded" }, { status: 404 });
    const url = await presignTenantDocumentDownload(key);
    return NextResponse.json({ success: true, url });
  } catch (err) {
    console.error("Tenant document download error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET /api/admin/tenant-requests?status=Pending — list tenant requests for
// the admin's society. `status` defaults to "Pending"; pass status=all for
// every status.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import TenantRequest from "@/models/TenantRequest";
import { requireRoles } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
export async function GET(request) {
  const gate = await authorize(request, "member.tenantRequest.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "Pending";
    const query = { societyId: gate.context.societyId };
    if (status !== "all") query.status = status;
    const items = await TenantRequest.find(query).sort({ createdAt: -1 }).limit(200).lean();
    return NextResponse.json({ success: true, items });
  } catch (err) {
    console.error("Tenant requests list error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

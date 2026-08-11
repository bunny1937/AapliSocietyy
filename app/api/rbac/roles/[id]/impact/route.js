/**
 * GET /api/rbac/roles/[id]/impact  (Phase 2) — destructive-delete preview (#10)
 * ----------------------------------------------------------------------------
 * Required permission : rbac.role.delete (you can only preview what you can delete)
 * Tenant validation   : societyId from token; service re-scopes by it
 * Audit behaviour      : none (read-only preview)
 * Failure behaviour    : 401/403 authorize; 404 role not found
 */

import { NextResponse } from "next/server";
import { authorize } from "@/lib/rbac/authorize";
import { roleImpact } from "@/lib/rbac/role-service";

export async function GET(request, { params }) {
  const gate = await authorize(request, "rbac.role.delete");
  if (!gate.ok) return gate.response;
  try {
    const impact = await roleImpact(gate.context.societyId, params.id);
    return NextResponse.json(impact);
  } catch (err) {
    if (err?.code === "ROLE_NOT_FOUND")
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    console.error("[rbac] role impact failed:", err?.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * POST /api/rbac/roles/[id]/restore-defaults  (Phase 2) — reset system template
 * ----------------------------------------------------------------------------
 * Required permission : rbac.role.restoreDefaults
 * Tenant validation   : societyId from token; service re-scopes by it
 * Audit behaviour      : ROLE_DEFAULTS_RESTORED (service); reductions force re-auth
 * Failure behaviour    : 401/403 authorize; 404 not found; 409 not a system role
 */

import { NextResponse } from "next/server";
import { authorize } from "@/lib/rbac/authorize";
import { restoreDefaults } from "@/lib/rbac/role-service";

export async function POST(request, { params }) {
  const gate = await authorize(request, "rbac.role.restoreDefaults");
  if (!gate.ok) return gate.response;
  try {
    const result = await restoreDefaults({
      societyId: gate.context.societyId,
      actorId: gate.context.userId,
      roleId: params.id,
    });
    return NextResponse.json(result);
  } catch (err) {
    const map = {
      ROLE_NOT_FOUND: 404,
      NOT_A_SYSTEM_ROLE: 409,
      NO_DEFAULTS: 409,
    };
    const status = map[err?.code] || 500;
    if (status === 500)
      console.error("[rbac] restore-defaults failed:", err?.message);
    return NextResponse.json(
      { error: err?.message || "Internal error", code: err?.code },
      { status },
    );
  }
}

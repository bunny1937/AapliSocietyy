/**
 * GET /api/rbac/roles/[id]/impact  (Phase 2) — change preview (#10)
 * ----------------------------------------------------------------------------
 * Required permission : rbac.role.delete OR rbac.role.update
 * Tenant validation   : societyId from token; service re-scopes by it
 * Audit behaviour      : none (read-only preview)
 * Failure behaviour    : 401/403 authorize; 404 role not found
 *
 * ## Why update was added to a delete-only route
 *
 * This began as the delete confirmation: "3 people hold this role, deleting it
 * removes it from all of them." Editing a role down is the same event arriving
 * more quietly — strip Manage from Payments and those same 3 people lose it on
 * their next request, with no preview and no confirmation, because a reduction
 * bumps their sessionEpoch and forces re-auth (updateRole, Q11).
 *
 * The count is the same count and the question is the same question, so the
 * route is shared rather than duplicated. Widening it grants nothing new:
 * `roleImpact` returns a holder count and ids for a role in the caller's own
 * society, and anyone holding rbac.role.update can already read the role and
 * its assignments through /api/rbac/roles and /api/rbac/assignments.
 */

import { NextResponse } from "next/server";
import { authorizeAny } from "@/lib/rbac/authorize";
import { roleImpact } from "@/lib/rbac/role-service";

export async function GET(request, { params }) {
  const gate = await authorizeAny(request, [
    "rbac.role.delete",
    "rbac.role.update",
  ]);
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

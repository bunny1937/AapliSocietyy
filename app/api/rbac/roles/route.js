/**
 * /api/rbac/roles  (Phase 2)
 * ----------------------------------------------------------------------------
 * GET  list roles          Required permission: rbac.role.view
 * POST create/clone role   Required permission: rbac.role.create
 * Tenant validation   : societyId taken from verified token context (never body)
 * Audit behaviour      : POST writes ROLE_CREATED or ROLE_CLONED (in service)
 * Failure behaviour    : 401/403 via authorize; 400 on unknown perms;
 *                        200 with `warnings[]` when actor perms were trimmed
 */

import { NextResponse } from "next/server";
import { authorize } from "@/lib/rbac/authorize";
import { listRoles, createRole } from "@/lib/rbac/role-service";
import { expandPageAccess } from "@/lib/rbac/page-access-map";

export async function GET(request) {
  const gate = await authorize(request, "rbac.role.view");
  if (!gate.ok) return gate.response;
  const roles = await listRoles(gate.context.societyId);
  return NextResponse.json({ roles });
}

export async function POST(request) {
  const gate = await authorize(request, "rbac.role.create");
  if (!gate.ok) return gate.response;
  const { societyId, userId } = gate.context;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const {
    name,
    description,
    color,
    permissions,
    denies,
    cloneFromRoleId,
    pageAccess,
  } = body || {};
  if (!name || typeof name !== "string") {
    return NextResponse.json(
      { error: "Role name is required" },
      { status: 400 },
    );
  }

  // Spoon-fed input: the wizard sends [{pageKey, level}], never raw permission
  // ids. Expand server-side so the client never has to know the RBAC internals.
  const effectivePermissions = Array.isArray(pageAccess)
    ? expandPageAccess(pageAccess)
    : permissions || [];

  try {
    const { role, warnings } = await createRole({
      societyId,
      actorId: userId,
      name,
      description,
      color,
      permissions: effectivePermissions,
      denies: denies || [],
      cloneFromRoleId: cloneFromRoleId || null,
    });
    return NextResponse.json({ role, warnings }, { status: 201 });
  } catch (err) {
    return mapServiceError(err);
  }
}

function mapServiceError(err) {
  const code = err?.code;
  if (code === "UNKNOWN_PERMISSIONS")
    return NextResponse.json(
      { error: "Unknown permissions", code, unknown: err.unknown },
      { status: 400 },
    );
  if (code === "CLONE_SOURCE_NOT_FOUND")
    return NextResponse.json(
      { error: "Clone source not found", code },
      { status: 404 },
    );
  console.error("[rbac] roles POST failed:", err?.message);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

/**
 * /api/rbac/users  (Phase 3 — access-management surface)
 * ----------------------------------------------------------------------------
 * GET  list society login users + their active roles   perm: rbac.user.view
 *      optional ?roleId=<id> to filter to one role
 * POST create a login user AND assign a role in one step  perm: rbac.user.create
 *      body: { name, email?, username?, password, roleId, expiresAt? }
 *
 * Tenant validation : societyId taken from the verified token context, never body.
 * Audit behaviour   : POST writes ROLE_ASSIGNED (assignRole) + USER_CREATED.
 *                     Creating/assigning is a GRANT => no forced logout.
 * Failure behaviour : 401/403 authorize; 400 validation/bad JSON;
 *                     404 role not found; 409 duplicate username/email;
 *                     403 PRIVILEGE_ESCALATION (role exceeds actor's perms).
 */

import { NextResponse } from "next/server";
import { authorize } from "@/lib/rbac/authorize";
import { listSocietyUsers, createStaffUser } from "@/lib/rbac/user-service";

export async function GET(request) {
  const gate = await authorize(request, "rbac.user.view");
  if (!gate.ok) return gate.response;
  const url = new URL(request.url);
  const users = await listSocietyUsers(gate.context.societyId, {
    roleId: url.searchParams.get("roleId") || undefined,
  });
  return NextResponse.json({ users });
}

export async function POST(request) {
  const gate = await authorize(request, "rbac.user.create");
  if (!gate.ok) return gate.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, email, username, password, roleId, expiresAt, gateLabel, phone } =
    body || {};

  try {
    const result = await createStaffUser({
      societyId: gate.context.societyId,
      actorId: gate.context.userId,
      name,
      email,
      username,
      password,
      roleId,
      expiresAt: expiresAt || null,
      // Only meaningful when the role being assigned is Security; the service
      // ignores them otherwise. See the guard exception in user-service.js.
      gateLabel,
      phone,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const code = err?.code;
    if (code === "VALIDATION")
      return NextResponse.json({ error: err.message, code }, { status: 400 });
    if (code === "ROLE_NOT_FOUND")
      return NextResponse.json({ error: err.message, code }, { status: 404 });
    if (code === "DUPLICATE_USERNAME" || code === "DUPLICATE_EMAIL")
      return NextResponse.json({ error: err.message, code }, { status: 409 });
    if (code === "PRIVILEGE_ESCALATION")
      return NextResponse.json(
        { error: err.message, code, escalating: err.escalating },
        { status: 403 },
      );
    console.error("[rbac] users POST failed:", err?.message);
    return NextResponse.json(
      { error: "Internal error", code: code || null },
      { status: 500 },
    );
  }
}

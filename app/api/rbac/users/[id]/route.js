/**
 * PATCH /api/rbac/users/[id]  (Phase 2) — suspend / reactivate an account
 * ----------------------------------------------------------------------------
 * Required permission : rbac.user.suspend  (action=suspend)
 *                       rbac.user.reactivate (action=reactivate)
 *                       — SEPARATE permissions, authorized independently. These
 *                       dangerous lifecycle actions are NEVER merged (Phase 2
 *                       mandatory correction #4).
 * Tenant validation   : societyId from token; action audited under that society
 * Audit behaviour      : USER_SUSPENDED / USER_REACTIVATED (service layer)
 *                        Suspend forces immediate logout (sessionEpoch bump).
 * Failure behaviour    : 400 bad/absent action BEFORE any mutation;
 *                        401/403 from authorize (fail-closed) -> /my-access;
 *                        404 user not found; 500 unexpected.
 */

import { NextResponse } from "next/server";
import { authorize } from "@/lib/rbac/authorize";
import { suspendUser, reactivateUser } from "@/lib/rbac/assignment-service";

// Map each lifecycle action to its OWN permission (no shared/merged perm).
const ACTION_PERMISSION = {
  suspend: "rbac.user.suspend",
  reactivate: "rbac.user.reactivate",
};

export async function PATCH(request, { params }) {
  // Parse + validate the action FIRST so we authorize the correct permission.
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const action = body?.action;
  const requiredPermission = ACTION_PERMISSION[action];
  if (!requiredPermission) {
    return NextResponse.json(
      { error: "action must be 'suspend' or 'reactivate'" },
      { status: 400 },
    );
  }

  // Authorize the SPECIFIC permission for this action (fail-closed).
  const gate = await authorize(request, requiredPermission);
  if (!gate.ok) return gate.response;

  const ctx = {
    societyId: gate.context.societyId,
    actorId: gate.context.userId,
    userId: params.id,
  };
  try {
    if (action === "suspend") {
      return NextResponse.json(
        await suspendUser({ ...ctx, reason: body?.reason }),
      );
    }
    return NextResponse.json(await reactivateUser(ctx));
  } catch (err) {
    if (err?.code === "USER_NOT_FOUND") {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    console.error("[rbac] user PATCH failed:", err?.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

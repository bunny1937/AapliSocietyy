/**
 * DELETE /api/rbac/assignments/[id]  (Phase 2) — revoke a role from a user
 * ----------------------------------------------------------------------------
 * Required permission : rbac.assignment.unassign
 * Tenant validation   : societyId from token; assignment re-scoped by it
 * Audit behaviour      : ROLE_UNASSIGNED (service). Reduction => forces re-auth.
 * Failure behaviour    : 401/403 authorize; 404 assignment not found
 */

import { NextResponse } from "next/server";
import { authorize } from "@/lib/rbac/authorize";
import { unassignRole } from "@/lib/rbac/assignment-service";

export async function DELETE(request, { params }) {
  const gate = await authorize(request, "rbac.assignment.unassign");
  if (!gate.ok) return gate.response;
  try {
    const result = await unassignRole({
      societyId: gate.context.societyId,
      actorId: gate.context.userId,
      assignmentId: params.id,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err?.code === "ASSIGNMENT_NOT_FOUND")
      return NextResponse.json(
        { error: "Assignment not found" },
        { status: 404 },
      );
    console.error("[rbac] assignment DELETE failed:", err?.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

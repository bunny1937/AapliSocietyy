/**
 * ============================================================================
 * AapliSociety RBAC — Assignment service (Phase 2)
 * ============================================================================
 * Grants/revokes roles to users within a society, plus account suspend/react.
 *
 * Invariants (frozen Rev 2):
 *   - Tenant-scoped: every op requires societyId; assignments are per-society.
 *   - Anti-escalation: an actor can only assign a role whose permission set is
 *     a subset of the actor's own effective permissions.
 *   - Grants do NOT force logout; revocations/suspensions DO (Q11).
 *   - Idempotent assign (unique {userId, societyId, roleId}); re-assign
 *     reactivates a previously revoked record instead of duplicating.
 *   - Every op audited; every op rotates Society.rbacVersion.
 * ============================================================================
 */

import connectDB from "@/lib/mongodb";
import Role from "@/models/Role";
import RoleAssignment from "@/models/RoleAssignment";
import User from "@/models/User";
import { resolveEffectivePermissions, HAT } from "@/lib/rbac/permission-engine";
import { onRbacMutation, bumpSessionEpoch } from "@/lib/rbac/session";
import {
  auditRoleAssigned,
  auditRoleUnassigned,
  auditUserSuspended,
  auditUserReactivated,
} from "@/lib/rbac/rbac-audit";

export async function listAssignments(societyId, { userId, roleId } = {}) {
  await connectDB();
  const q = { societyId };
  if (userId) q.userId = userId;
  if (roleId) q.roleId = roleId;
  return RoleAssignment.find(q).sort({ createdAt: -1 }).lean();
}

/**
 * Active RBAC role keys (e.g. "clubhouse_manager") a user holds in a society,
 * right now. Feeds the /v1 mobile auth flow (issueTokens + /auth/me): the
 * mobile app has no other way to see roles granted through Manage Access,
 * since it only ever read user.profiles[].role / user.role, never
 * RoleAssignment. Deliberately roleKey-only (no permission leaves) — the app
 * shows the role, per-request authorization still resolves permissions
 * server-side via resolveEffectivePermissions.
 */
export async function listActiveStaffRoleKeys(userId, societyId) {
  if (!userId || !societyId) return [];
  await connectDB();
  const now = new Date();
  const assignments = await RoleAssignment.find({
    userId,
    societyId,
    status: "active",
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  })
    .select("roleKey")
    .lean();
  return [...new Set(assignments.map((a) => a.roleKey))];
}

/**
 * Same active assignments as listActiveStaffRoleKeys, but with each role's
 * current display name attached (`Role.name` — societies can rename their own
 * copy of a system template, e.g. "Clubhouse Manager" -> "Clubhouse Desk", so
 * the label a client shows has to come from here, not be re-derived from the
 * key). Feeds GET /v1/auth/me's `claims.roles`, which is what lets the mobile
 * app render "open as <role>" entry points without hardcoding any role's name
 * — see lib/v1/staffRoleRoutes.js for the one piece that IS still hardcoded
 * (which mobile screen a key opens).
 */
export async function listActiveStaffRoles(userId, societyId) {
  if (!userId || !societyId) return [];
  await connectDB();
  const now = new Date();
  const assignments = await RoleAssignment.find({
    userId,
    societyId,
    status: "active",
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  })
    .select("roleKey roleId")
    .populate({ path: "roleId", select: "name permissions", model: Role })
    .lean();
  const seen = new Set();
  const out = [];
  for (const a of assignments) {
    if (seen.has(a.roleKey)) continue;
    seen.add(a.roleKey);
    // permissions carried through so resolveStaffRoleRoute() (staffRoleRoutes.js)
    // can find a mobile console by capability when the role's key isn't the
    // hardcoded one — e.g. a hand-built or renamed clone of a system template.
    out.push({
      key: a.roleKey,
      label: a.roleId?.name ?? a.roleKey,
      permissions: a.roleId?.permissions ?? [],
    });
  }
  return out;
}

/**
 * Assign a role to a user in a society.
 * @returns { assignment, reactivated }
 */
export async function assignRole({
  societyId,
  actorId,
  userId,
  roleId,
  expiresAt = null,
  isSuperGrantor = false,
}) {
  await connectDB();

  const role = await Role.findOne({ _id: roleId, societyId }).lean();
  if (!role)
    throw Object.assign(new Error("Role not found"), {
      code: "ROLE_NOT_FOUND",
    });

  const target = await User.findById(userId).select("_id status").lean();
  if (!target)
    throw Object.assign(new Error("User not found"), {
      code: "USER_NOT_FOUND",
    });

  // Anti-escalation: role.permissions must be subset of actor's effective perms.
  if (!isSuperGrantor) {
    const actorPerms = await resolveEffectivePermissions({
      userId: actorId,
      societyId,
      hat: HAT.STAFF,
    });
    const escalating = (role.permissions || []).filter(
      (p) => !actorPerms.has(p),
    );
    if (escalating.length) {
      throw Object.assign(
        new Error("Cannot assign a role granting permissions you don't hold"),
        {
          code: "PRIVILEGE_ESCALATION",
          escalating,
        },
      );
    }
  }

  // Idempotent upsert: reactivate a revoked record instead of duplicating.
  const existing = await RoleAssignment.findOne({ userId, societyId, roleId });
  let assignment;
  let reactivated = false;
  if (existing) {
    reactivated = existing.status !== "active";
    existing.status = "active";
    existing.roleKey = role.key;
    existing.expiresAt = expiresAt;
    existing.assignedBy = actorId;
    existing.revokedBy = null;
    existing.revokedAt = null;
    assignment = await existing.save();
  } else {
    assignment = await RoleAssignment.create({
      userId,
      societyId,
      roleId,
      roleKey: role.key,
      status: "active",
      expiresAt,
      assignedBy: actorId,
    });
  }

  await auditRoleAssigned({ actorId, societyId, userId, role });
  // Grant => rotate cache so new perms take effect immediately; NO forced logout.
  await onRbacMutation({ societyId });
  return { assignment: assignment.toObject(), reactivated };
}

/** Revoke a role from a user. Reduction => force re-auth (Q11). */
export async function unassignRole({ societyId, actorId, assignmentId }) {
  await connectDB();
  const assignment = await RoleAssignment.findOne({
    _id: assignmentId,
    societyId,
  });
  if (!assignment)
    throw Object.assign(new Error("Assignment not found"), {
      code: "ASSIGNMENT_NOT_FOUND",
    });
  if (assignment.status !== "active") return { alreadyRevoked: true };

  assignment.status = "revoked";
  assignment.revokedBy = actorId;
  assignment.revokedAt = new Date();
  await assignment.save();

  const role = await Role.findById(assignment.roleId).lean();
  await auditRoleUnassigned({
    actorId,
    societyId,
    userId: String(assignment.userId),
    role,
  });

  await bumpSessionEpoch(String(assignment.userId)); // reduction => re-auth
  await onRbacMutation({ societyId });
  return { revoked: true };
}

/** Suspend an account: blocks all authorization + forces logout everywhere. */
export async function suspendUser({
  societyId,
  actorId,
  userId,
  reason = null,
}) {
  await connectDB();
  const user = await User.findByIdAndUpdate(
    userId,
    { $set: { status: "suspended" } },
    { new: true },
  );
  if (!user)
    throw Object.assign(new Error("User not found"), {
      code: "USER_NOT_FOUND",
    });
  await auditUserSuspended({ actorId, societyId, userId, reason });
  await bumpSessionEpoch(userId); // immediate lockout
  await onRbacMutation({ societyId });
  return { suspended: true };
}

/** Reactivate a suspended account. Grant-like => no forced logout needed. */
export async function reactivateUser({ societyId, actorId, userId }) {
  await connectDB();
  const user = await User.findByIdAndUpdate(
    userId,
    { $set: { status: "active" } },
    { new: true },
  );
  if (!user)
    throw Object.assign(new Error("User not found"), {
      code: "USER_NOT_FOUND",
    });
  await auditUserReactivated({ actorId, societyId, userId });
  await onRbacMutation({ societyId });
  return { reactivated: true };
}

export default {
  listAssignments,
  listActiveStaffRoleKeys,
  listActiveStaffRoles,
  assignRole,
  unassignRole,
  suspendUser,
  reactivateUser,
};

/**
 * ============================================================================
 * AapliSociety RBAC — Role service (Phase 2)
 * ============================================================================
 * Business logic for role lifecycle. Routes stay thin; ALL invariants live
 * here so the rules can't be bypassed by a forgetful route.
 *
 * Invariants enforced (from frozen Rev 2):
 *   - Deny-by-default: unknown permission ids are REJECTED (Rule 9, no implied).
 *   - Anti-privilege-escalation: an actor may only grant permissions they
 *     themselves currently hold (clone/create/update trim to actorPerms).
 *   - System templates: editable (permissions) but identity-locked (key/name)
 *     and UNDELETABLE (Decision #4 / #10).
 *   - EXCEPT Admin, whose permission set and denies are locked too — the engine
 *     short-circuits Admin to every permission and never reads the array, so
 *     accepting a write to it would persist a claim the product contradicts
 *     (PERMISSION_LOCKED_SYSTEM_KEYS).
 *   - Reductions force re-auth: removing a permission from a role bumps the
 *     sessionEpoch of every affected user (Q11). Grants do NOT force logout.
 *   - Every mutation bumps Society.rbacVersion (cache rotation) and is audited.
 *   - Optimistic concurrency: callers retry on VersionError.
 * ============================================================================
 */

import connectDB from "@/lib/mongodb";
import Role from "@/models/Role";
import RoleAssignment from "@/models/RoleAssignment";
import { registry } from "@/lib/rbac/registry";
import { resolveEffectivePermissions, HAT } from "@/lib/rbac/permission-engine";
import { getSystemRoleDefault } from "@/lib/rbac/system-role-defaults";
import { onRbacMutation, bumpSessionEpoch } from "@/lib/rbac/session";
import {
  auditRoleCreated,
  auditRoleUpdated,
  auditRoleDeleted,
  auditRoleCloned,
  auditDefaultsRestored,
} from "@/lib/rbac/rbac-audit";

const MAX_RETRIES = 3;

/**
 * The one system role whose permission SET is locked, not just its identity.
 *
 * Every other system template is editable per Decision Q4 — a society may
 * decide its Secretary does not touch billing, and that is theirs to decide.
 *
 * Admin is different, but NOT because editing it could lock a society out.
 * It cannot: permission-engine.js short-circuits on
 * `r.isSystem && r.key === "admin"` and returns `registry.allIds()` without
 * ever reading `permissions`, and deny-override is explicitly skipped for the
 * superuser. Whatever this array holds, an Admin can already do everything.
 *
 * That is precisely the problem. Accepting a write to a field nothing reads
 * stores a lie: the row says "Admin cannot export bills", the product lets
 * them export bills, and the audit trail records a revocation that never
 * took effect. Someone eventually trusts the row over the engine.
 *
 * RoleManager already refuses to show a permission picker for Admin (it opens
 * an "admin-locked" editor with no pageAccess) for the same reason. This is
 * the server-side half of that decision, so a direct PATCH cannot do what the
 * UI declines to offer.
 *
 * Identity (name/key) is already locked below and deletion is refused in
 * deleteRole. Description and colour stay editable — they are honest fields.
 *
 * Societies wanting a narrower top-level role clone Admin and edit the clone.
 */
const PERMISSION_LOCKED_SYSTEM_KEYS = new Set(["admin"]);

/** Validate + expand a requested permission list against the registry. */
function normalizePermissions(requested = []) {
  const unknown = [];
  const leaves = new Set();
  for (const id of requested) {
    if (registry.has(id)) {
      leaves.add(id);
      continue;
    }
    // Wildcards (billing.*, billing.bill.*) are expanded to concrete leaves.
    const expanded = registry.expand(id);
    if (expanded.length === 0) {
      unknown.push(id); // Rule 9: never silently accept/imply.
    } else {
      expanded.forEach((leaf) => leaves.add(leaf));
    }
  }
  return { leaves: [...leaves], unknown };
}

/** Intersect requested leaves with what the actor is allowed to grant. */
function trimToActor(leaves, actorPerms, { isSuperGrantor }) {
  if (isSuperGrantor) return { granted: leaves, refused: [] };
  const granted = [];
  const refused = [];
  for (const id of leaves) {
    if (actorPerms.has(id)) granted.push(id);
    else refused.push(id);
  }
  return { granted, refused };
}

async function getActorPerms({ actorId, societyId, actorHat = HAT.STAFF }) {
  return resolveEffectivePermissions({
    userId: actorId,
    societyId,
    hat: actorHat,
  });
}

export async function listRoles(societyId) {
  await connectDB();
  return Role.find({ societyId }).sort({ isSystem: -1, name: 1 }).lean();
}

export async function getRole(societyId, roleId) {
  await connectDB();
  return Role.findOne({ _id: roleId, societyId }).lean();
}

/**
 * Create a custom role (optionally cloned). Returns { role, warnings }.
 * Throws { code } on hard failures so the route maps to a status code.
 */
export async function createRole({
  societyId,
  actorId,
  name,
  description = "",
  color = null,
  permissions = [],
  denies = [],
  cloneFromRoleId = null,
  isSuperGrantor = false,
}) {
  await connectDB();
  const warnings = [];

  let basePerms = permissions;
  let clonedFromKey = null;
  if (cloneFromRoleId) {
    const src = await Role.findOne({ _id: cloneFromRoleId, societyId }).lean();
    if (!src)
      throw Object.assign(new Error("Source role not found"), {
        code: "CLONE_SOURCE_NOT_FOUND",
      });
    basePerms = src.permissions || [];
    clonedFromKey = src.key;
  }

  const { leaves, unknown } = normalizePermissions(basePerms);
  if (unknown.length) {
    // Surface, do not silently drop-and-proceed on a create with typo'd ids.
    throw Object.assign(new Error("Unknown permissions"), {
      code: "UNKNOWN_PERMISSIONS",
      unknown,
    });
  }

  const actorPerms = await getActorPerms({ actorId, societyId });
  const { granted, refused } = trimToActor(leaves, actorPerms, {
    isSuperGrantor,
  });
  if (refused.length) {
    warnings.push({
      code: "PRIVILEGE_TRIMMED",
      message: "Some permissions were removed because you don't hold them.",
      refused,
    });
  }

  const { leaves: denyLeaves } = normalizePermissions(denies);

  const role = await Role.create({
    societyId,
    name,
    key: `custom.${slugify(name)}.${Date.now().toString(36)}`,
    description,
    color,
    isSystem: false,
    permissions: granted,
    denies: denyLeaves,
    clonedFromKey,
    createdBy: actorId,
    updatedBy: actorId,
  });

  if (cloneFromRoleId)
    await auditRoleCloned({ actorId, societyId, role, clonedFromKey });
  else await auditRoleCreated({ actorId, societyId, role });

  // Creating a role grants nothing to anyone yet => cache rotate only, no epoch.
  await onRbacMutation({ societyId });
  return { role: role.toObject(), warnings };
}

/**
 * Update a role's permissions/metadata. Detects reductions and forces re-auth
 * for affected users. Optimistic-concurrency safe (retries on VersionError).
 */
export async function updateRole({
  societyId,
  actorId,
  roleId,
  name,
  description,
  color,
  permissions,
  denies,
  isSuperGrantor = false,
}) {
  await connectDB();
  const warnings = [];

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const role = await Role.findOne({ _id: roleId, societyId });
    if (!role)
      throw Object.assign(new Error("Role not found"), {
        code: "ROLE_NOT_FOUND",
      });

    // Identity lock for system templates (Rule: never redesign; Decision #4).
    if (role.isSystem && name != null && name !== role.name) {
      throw Object.assign(new Error("System role name is locked"), {
        code: "SYSTEM_ROLE_LOCKED",
      });
    }

    // Permission lock for Admin — the anti-lockout guard. See
    // PERMISSION_LOCKED_SYSTEM_KEYS. Refuse the write rather than silently
    // ignoring the field, so the caller never believes an edit landed.
    if (
      role.isSystem &&
      PERMISSION_LOCKED_SYSTEM_KEYS.has(role.key) &&
      (permissions != null || denies != null)
    ) {
      throw Object.assign(
        new Error(
          `The ${role.name} role's permissions cannot be changed. Clone it and edit the copy.`,
        ),
        { code: "ROLE_PERMISSIONS_LOCKED", roleKey: role.key },
      );
    }

    const before = new Set(role.permissions || []);

    if (permissions != null) {
      const { leaves, unknown } = normalizePermissions(permissions);
      if (unknown.length)
        throw Object.assign(new Error("Unknown permissions"), {
          code: "UNKNOWN_PERMISSIONS",
          unknown,
        });
      const actorPerms = await getActorPerms({ actorId, societyId });
      const { granted, refused } = trimToActor(leaves, actorPerms, {
        isSuperGrantor,
      });
      // Anti-escalation must not let an actor STRIP a perm they can't grant back.
      // Keep any existing perm the actor cannot manage, so they can't lock others out
      // of capabilities beyond the actor's authority, then re-add refused grants.
      const preserved = [...before].filter((id) => !actorPerms.has(id));
      role.permissions = [...new Set([...granted, ...preserved])];
      if (refused.length) warnings.push({ code: "PRIVILEGE_TRIMMED", refused });
    }
    if (denies != null) {
      const { leaves: denyLeaves } = normalizePermissions(denies);
      role.denies = denyLeaves;
    }
    if (name != null && !role.isSystem) role.name = name;
    if (description != null) role.description = description;
    if (color !== undefined) role.color = color;
    role.updatedBy = actorId;

    const after = new Set(role.permissions || []);
    const removed = [...before].filter((id) => !after.has(id));
    const added = [...after].filter((id) => !before.has(id));

    try {
      await role.save(); // throws VersionError on concurrent edit
    } catch (err) {
      if (err?.name === "VersionError" && attempt < MAX_RETRIES - 1) continue; // retry
      throw err;
    }

    await auditRoleUpdated({ actorId, societyId, role, added, removed });

    // Reduction => force re-auth for everyone holding this role (Q11).
    if (removed.length) {
      const affected = await affectedUserIds(societyId, roleId);
      await Promise.all(affected.map((uid) => bumpSessionEpoch(uid)));
    }
    await onRbacMutation({ societyId });
    return { role: role.toObject(), added, removed, warnings };
  }
  throw Object.assign(new Error("Concurrent update conflict"), {
    code: "CONCURRENCY_CONFLICT",
  });
}

/** Impact preview before a destructive delete (Decision #10). */
export async function roleImpact(societyId, roleId) {
  await connectDB();
  const role = await Role.findOne({ _id: roleId, societyId }).lean();
  if (!role)
    throw Object.assign(new Error("Role not found"), {
      code: "ROLE_NOT_FOUND",
    });
  const assignments = await RoleAssignment.find({
    societyId,
    roleId,
    status: "active",
  })
    .select("userId")
    .lean();
  return {
    role,
    isSystem: role.isSystem,
    deletable: !role.isSystem,
    affectedUserCount: assignments.length,
    affectedUserIds: assignments.map((a) => String(a.userId)),
    permissionCount: (role.permissions || []).length,
  };
}

/** Delete a custom role. System roles are undeletable. Cascades assignments. */
export async function deleteRole({ societyId, actorId, roleId }) {
  await connectDB();
  const role = await Role.findOne({ _id: roleId, societyId });
  if (!role)
    throw Object.assign(new Error("Role not found"), {
      code: "ROLE_NOT_FOUND",
    });
  if (role.isSystem)
    throw Object.assign(new Error("System roles cannot be deleted"), {
      code: "SYSTEM_ROLE_UNDELETABLE",
    });

  const affected = await affectedUserIds(societyId, roleId);

  // Cascade: revoke (not hard-delete) assignments to preserve audit trail.
  await RoleAssignment.updateMany(
    { societyId, roleId, status: "active" },
    { $set: { status: "revoked", revokedBy: actorId, revokedAt: new Date() } },
  );
  await role.deleteOne(); // pre-hook re-guards isSystem

  await auditRoleDeleted({
    actorId,
    societyId,
    role,
    affectedUserIds: affected,
  });

  // Losing a role is a reduction => force re-auth for affected users.
  await Promise.all(affected.map((uid) => bumpSessionEpoch(uid)));
  await onRbacMutation({ societyId });
  return { deleted: true, affectedUserCount: affected.length };
}

/** Reset a system template back to factory defaults (Decision #4). */
export async function restoreDefaults({ societyId, actorId, roleId }) {
  await connectDB();
  const role = await Role.findOne({ _id: roleId, societyId });
  if (!role)
    throw Object.assign(new Error("Role not found"), {
      code: "ROLE_NOT_FOUND",
    });
  if (!role.isSystem)
    throw Object.assign(new Error("Only system roles have defaults"), {
      code: "NOT_A_SYSTEM_ROLE",
    });

  const def = getSystemRoleDefault(role.key);
  if (!def)
    throw Object.assign(new Error("No defaults for this role key"), {
      code: "NO_DEFAULTS",
    });

  const before = new Set(role.permissions || []);
  const { leaves } = normalizePermissions(def.permissions);
  role.permissions = leaves;
  role.denies = [];
  role.updatedBy = actorId;
  await role.save();

  const after = new Set(leaves);
  const removed = [...before].filter((id) => !after.has(id));
  await auditDefaultsRestored({ actorId, societyId, role });

  if (removed.length) {
    const affected = await affectedUserIds(societyId, roleId);
    await Promise.all(affected.map((uid) => bumpSessionEpoch(uid)));
  }
  await onRbacMutation({ societyId });
  return { role: role.toObject(), removed };
}

async function affectedUserIds(societyId, roleId) {
  const rows = await RoleAssignment.find({
    societyId,
    roleId,
    status: "active",
  })
    .select("userId")
    .lean();
  return [...new Set(rows.map((r) => String(r.userId)))];
}

function slugify(s) {
  return (
    String(s || "role")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "role"
  );
}

export default {
  listRoles,
  getRole,
  createRole,
  updateRole,
  roleImpact,
  deleteRole,
  restoreDefaults,
};

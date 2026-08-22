// lib/rbac/ensure-admin-assignment.js
//
// Every account that logs in as a root-role Admin/Secretary/Accountant/
// Security now needs a live RoleAssignment for its society — the legacy
// login branch that used to accept the bare root `role` string was deleted
// (see app/api/auth/login/route.js). scripts/rbac/backfill-assignments.js
// migrated every EXISTING account; this is the same operation for accounts
// created going forward, called from every place that still creates one
// with a root role: app/api/admin/societies/create, app/api/admin/bulk-import,
// app/api/auth/signup.
//
// Idempotent and safe to call even when the Role template does not exist yet
// for a brand-new society — it creates it inline from the system default
// rather than requiring a separate seed-roles run first.
import connectDB from "@/lib/mongodb";
import Role from "@/models/Role";
import RoleAssignment from "@/models/RoleAssignment";
import { getSystemRoleDefault } from "@/lib/rbac/system-role-defaults";

const LEGACY_ROLE_TO_KEY = {
  Admin: "admin",
  SOCIETY_ADMIN: "admin",
  Secretary: "secretary",
  Accountant: "accountant",
  Security: "security",
};

/**
 * @param {{userId, societyId, legacyRole: string}} args
 * @returns {Promise<null | { roleKey: string, assignmentId: string }>}
 *          null when `legacyRole` has no RBAC equivalent (nothing to do).
 */
export async function ensureAdminAssignment({ userId, societyId, legacyRole }) {
  const key = LEGACY_ROLE_TO_KEY[legacyRole];
  if (!key || !societyId) return null;
  await connectDB();

  let role = await Role.findOne({ societyId, key });
  if (!role) {
    const template = getSystemRoleDefault(key);
    if (!template) return null;
    // Upsert races the same way seed-roles.js does: a duplicate-key error here
    // means another request created it a moment ago — re-read and continue.
    try {
      role = await Role.create({
        societyId,
        key: template.key,
        name: template.name,
        description: template.description,
        color: template.color,
        permissions: template.permissions,
        isSystem: true,
      });
    } catch (err) {
      if (err?.code === 11000) {
        role = await Role.findOne({ societyId, key });
      } else {
        throw err;
      }
    }
  }
  if (!role) return null;

  const existing = await RoleAssignment.findOne({ userId, societyId, roleId: role._id });
  if (existing) {
    if (existing.status !== "active") {
      existing.status = "active";
      existing.revokedBy = null;
      existing.revokedAt = null;
      await existing.save();
    }
    return { roleKey: role.key, assignmentId: String(existing._id) };
  }

  const created = await RoleAssignment.create({
    userId,
    societyId,
    roleId: role._id,
    roleKey: role.key,
    status: "active",
    assignedBy: null, // system-issued at account creation
  });
  return { roleKey: role.key, assignmentId: String(created._id) };
}

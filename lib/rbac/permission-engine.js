/**
 * ============================================================================
 * AapliSociety RBAC — Permission Engine (effective-permission resolver)
 * ============================================================================
 * Deny-by-default. Backend is the ONLY source of truth. The engine computes
 * the set of concrete leaf permission ids a user has, for ONE active context
 * (one society + one "hat").
 *
 * Evaluation rules (frozen Rev 2):
 *   - STAFF hat: union of permissions across the user's ACTIVE RoleAssignments
 *     IN THAT SOCIETY ONLY, then remove anything in any of those roles' denies
 *     (deny-override wins). Other societies and the member hat are NEVER unioned.
 *   - MEMBER hat: fixed MEMBER_CAPABILITIES set (not admin-composable).
 *
 * Caching: perms:{userId}:{societyId}:{hat}:{rbacVersion} for 300s. Any RBAC
 * mutation bumps Society.rbacVersion which changes the key => instant, correct
 * invalidation. FAIL-CLOSED: any error resolving perms yields an EMPTY set.
 * ============================================================================
 */

import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import cache from "@/lib/cache";
import Role from "@/models/Role";
import RoleAssignment from "@/models/RoleAssignment";
import Society from "@/models/Society";
import User from "@/models/User";
import { registry } from "@/lib/rbac/registry";
import { MEMBER_CAPABILITIES } from "@/lib/rbac/system-role-defaults";

// The protected system role key that is treated as an all-powerful superuser.
const SUPERUSER_ROLE_KEY = "admin";

const PERMS_TTL = 300; // seconds

export const HAT = Object.freeze({ STAFF: "staff", MEMBER: "member" });

async function getRbacVersion(societyId) {
  // societyId here is always the Society _id (that's what tokens/
  // RoleAssignment.societyId carry) — NOT the human-readable Society.societyId
  // code field. Querying by the wrong field silently never matched, so
  // rbacVersion always resolved to 0 and cache-busting on role edits never
  // actually worked (bounded by the 300s TTL, but still wrong).
  if (!mongoose.isValidObjectId(societyId)) return 0;
  const s = await Society.findById(societyId).select("rbacVersion").lean();
  return s?.rbacVersion || 0;
}

/**
 * Compute effective permission ids for a user's active context.
 * @param {{ userId:string, societyId:string, hat?:string }} ctx
 * @returns {Promise<Set<string>>}
 */
export async function resolveEffectivePermissions({
  userId,
  societyId,
  hat = HAT.STAFF,
}) {
  // Deny-by-default: missing inputs => no permissions.
  if (!userId || !societyId) return new Set();

  try {
    await connectDB();

    // MEMBER hat is a fixed capability set — no roles, no union.
    if (hat === HAT.MEMBER) {
      return new Set(MEMBER_CAPABILITIES);
    }

    const rbacVersion = await getRbacVersion(societyId);
    const cacheKey = `perms:${userId}:${societyId}:${hat}:${rbacVersion}`;

    const ids = await cache.getOrSet(
      cacheKey,
      async () => computeStaffPermissions(userId, societyId),
      PERMS_TTL,
    );
    return new Set(Array.isArray(ids) ? ids : []);
  } catch (err) {
    // FAIL-CLOSED — never grant on error.
    console.error(
      "[rbac] resolveEffectivePermissions failed (fail-closed):",
      err?.message,
    );
    return new Set();
  }
}

/** Union active assignments' permissions minus their denies (deny-override). */
async function computeStaffPermissions(userId, societyId) {
  const now = new Date();

  const assignments = await RoleAssignment.find({
    userId,
    societyId,
    status: "active",
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  })
    .select("roleId")
    .lean();

  if (!assignments.length) {
    // No RBAC role assigned yet (bootstrap never run for this society, or
    // this admin wasn't seeded into it). The legacy society Admin account
    // must never be locked out by an RBAC rollout it hasn't opted into —
    // fall back to the same superuser set the seeded "admin" system role
    // gets, until a real RoleAssignment takes over.
    const user = await User.findById(userId).select("role societyId").lean();
    if (user?.role === "Admin" && String(user.societyId) === String(societyId)) {
      return registry.allIds();
    }
    return [];
  }

  const roleIds = assignments.map((a) => a.roleId);
  const roles = await Role.find({ _id: { $in: roleIds }, societyId })
    .select("key isSystem permissions denies")
    .lean();

  // SUPERUSER SHORT-CIRCUIT (Rev 2.1): the society's protected system "admin"
  // role is the top authority and can do ANYTHING. It always resolves to every
  // permission in the CURRENT catalog — so newly added permissions are granted
  // to admins automatically, with no re-seed, "restore defaults", or backfill.
  // Deny-override does NOT apply to the admin superuser (it can do anything).
  if (roles.some((r) => r.isSystem && r.key === SUPERUSER_ROLE_KEY)) {
    return registry.allIds();
  }

  const granted = new Set();
  const denied = new Set();
  for (const r of roles) {
    for (const p of r.permissions || []) granted.add(p);
    for (const d of r.denies || []) denied.add(d);
  }
  // Deny-override wins.
  for (const d of denied) granted.delete(d);
  return [...granted];
}

/** Pure predicate: does this resolved set satisfy a required permission? */
export function can(permSet, requiredId) {
  if (!permSet || !requiredId) return false;
  return permSet.has(requiredId);
}

/** Convenience: resolve + check in one call. */
export async function userCan({ userId, societyId, hat }, requiredId) {
  const set = await resolveEffectivePermissions({ userId, societyId, hat });
  return can(set, requiredId);
}

export default { resolveEffectivePermissions, can, userCan, HAT };

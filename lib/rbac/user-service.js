/**
 * ============================================================================
 * AapliSociety RBAC — User service (Phase 3 addition, additive to frozen core)
 * ============================================================================
 * Powers the access-management surface in the Role Manager UI:
 *   1. listSocietyUsers()  — society-scoped directory of login users + their
 *      active RBAC role assignments (optionally filtered to one role).
 *   2. createStaffUser()   — the “create a login user AND assign them a role in
 *      one step” flow. The saved credentials can immediately sign in through
 *      the existing /api/auth/login staff branch and use the restricted system.
 *
 * Invariants (respecting the frozen Phase 2 backend — nothing here redesigns it):
 *   - Tenant-scoped: societyId ALWAYS comes from the verified token context.
 *   - New login users get base role "Secretary" ONLY so they pass the staff
 *     branch of /api/auth/login and receive a society-scoped token. Their ACTUAL
 *     authority is governed 100% by their assigned RBAC role(s); the base role
 *     grants nothing extra on RBAC-migrated routes.
 *   - Role assignment goes through the frozen assignRole(), so it inherits
 *     anti-escalation (actor can only grant ≤ their own permissions), auditing,
 *     idempotency, and the permission-cache bump.
 *   - Passwords are bcrypt-hashed (cost 10), matching the rest of the app.
 *   - Password hashes are NEVER returned to callers.
 * ============================================================================
 */

import bcrypt from "bcryptjs";
import connectDB from "@/lib/mongodb";
import { isDuplicateKeyError } from "@/lib/mongoErrors";
import User from "@/models/User";
import Role from "@/models/Role";
import RoleAssignment from "@/models/RoleAssignment";
import { assignRole } from "@/lib/rbac/assignment-service";
import { auditRbac } from "@/lib/rbac/rbac-audit";
import { passwordPolicyProblem } from "@/lib/password-policy";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Least-privilege staff role that is accepted by the /api/auth/login staff
// branch. It exists only so the account can obtain a society-scoped token.
const STAFF_BASE_ROLE = "Secretary";
const STAFF_ROLES = ["Admin", "Secretary", "Accountant", "Security"];

function publicUser(u, societyId) {
  // Members carry societyId inside profiles[], not the root field, and no
  // root-level "flat" label — surface their flat/wing for THIS society so
  // the "assign existing person" picker can tell members apart by unit
  // instead of just a name (per master-plan Option A: pick an existing
  // member, don't create a duplicate account).
  const profile = (u.profiles || []).find(
    (p) => String(p.societyId) === String(societyId),
  );
  const flatLabel = profile
    ? [profile.wing, profile.flatNo].filter(Boolean).join("-")
    : "";
  return {
    id: String(u._id),
    name: u.name,
    email: u.email || "",
    username: u.username || "",
    status: u.status || "active",
    role: u.role,
    flat: flatLabel || null,
    createdAt: u.createdAt || null,
  };
}

function vErr(message) {
  return Object.assign(new Error(message), { code: "VALIDATION" });
}

/**
 * List login users in a society together with their ACTIVE RBAC role
 * assignments. When `roleId` is provided, only users holding that role are
 * returned (drives the per-role “Manage assignments” view). Without it, all
 * staff login accounts in the society are returned (so existing accounts can
 * be assigned).
 */
export async function listSocietyUsers(societyId, { roleId } = {}) {
  await connectDB();

  const aq = { societyId, status: "active" };
  if (roleId) aq.roleId = roleId;
  const assignments = await RoleAssignment.find(aq).lean();

  const roleIds = [...new Set(assignments.map((a) => String(a.roleId)))];
  const roles = roleIds.length
    ? await Role.find({ _id: { $in: roleIds }, societyId })
        .select("name key color")
        .lean()
    : [];
  const roleById = new Map(roles.map((r) => [String(r._id), r]));

  const byUser = new Map();
  for (const a of assignments) {
    const uid = String(a.userId);
    const r = roleById.get(String(a.roleId));
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid).push({
      assignmentId: String(a._id),
      roleId: String(a.roleId),
      roleKey: a.roleKey,
      roleName: r?.name || a.roleKey || "Role",
      roleColor: r?.color || null,
      expiresAt: a.expiresAt || null,
    });
  }

  let users;
  if (roleId) {
    users = await User.find({ _id: { $in: [...byUser.keys()] } })
      .select("name email username status role createdAt profiles")
      .sort({ createdAt: -1 })
      .lean();
  } else {
    // Two pools, merged: (1) legacy staff-role login accounts (Admin/
    // Secretary/Accountant/Security — root societyId), and (2) actual
    // society MEMBERS (role:"Member", societyId lives in profiles[]).
    // Members are the primary "assign an existing person" audience per the
    // master plan (existing resident gets an ADDITIONAL management profile,
    // no duplicate account) — excluding them here was the bug: this query
    // used to only return people who already had a staff role, so a freshly
    // bootstrapped society with just one Admin showed exactly one option.
    const [staff, members] = await Promise.all([
      User.find({ societyId, role: { $in: STAFF_ROLES } })
        .select("name email username status role createdAt profiles")
        .lean(),
      User.find({ role: "Member", "profiles.societyId": societyId })
        .select("name email username status role createdAt profiles")
        .sort({ createdAt: -1 })
        .limit(500)
        .lean(),
    ]);
    const seen = new Set();
    users = [];
    for (const u of [...staff, ...members]) {
      const id = String(u._id);
      if (seen.has(id)) continue;
      seen.add(id);
      users.push(u);
    }
  }

  return users.map((u) => ({
    ...publicUser(u, societyId),
    roles: byUser.get(String(u._id)) || [],
  }));
}

/**
 * Create a login account and assign it a role in one step.
 * @returns {{ user: object, assignment: object }}
 */
export async function createStaffUser({
  societyId,
  actorId,
  name,
  email,
  username,
  password,
  roleId,
  expiresAt = null,
}) {
  await connectDB();

  // ── validate ────────────────────────────────────────────────────
  const cleanName = String(name || "").trim();
  const cleanEmail = String(email || "")
    .trim()
    .toLowerCase();
  const cleanUsername = String(username || "")
    .trim()
    .toLowerCase();

  if (!cleanName) throw vErr("Name is required");
  if (!cleanEmail && !cleanUsername)
    throw vErr("Provide an email or a username to sign in with");
  if (cleanEmail && !EMAIL_RE.test(cleanEmail))
    throw vErr("That email address looks invalid");
  const pwProblem = passwordPolicyProblem(password);
  if (pwProblem) throw vErr(pwProblem);
  if (!roleId) throw vErr("A role is required");

  // Role must exist in this society (assignRole re-checks; fail early for a
  // clearer message).
  const role = await Role.findOne({ _id: roleId, societyId }).lean();
  if (!role)
    throw Object.assign(new Error("Role not found"), {
      code: "ROLE_NOT_FOUND",
    });

  // ── duplicate guards ──────────────────────────────────────────
  if (cleanUsername) {
    const dupe = await User.findOne({ username: cleanUsername })
      .select("_id")
      .lean();
    if (dupe)
      throw Object.assign(new Error("That username is already taken"), {
        code: "DUPLICATE_USERNAME",
      });
  }
  if (cleanEmail) {
    const dupe = await User.findOne({ email: cleanEmail, societyId })
      .select("_id")
      .lean();
    if (dupe)
      throw Object.assign(
        new Error("A user with that email already exists in this society"),
        { code: "DUPLICATE_EMAIL" },
      );
  }

  // ── create the login account ───────────────────────────────────
  const hashed = await bcrypt.hash(String(password), 10);
  let user;
  try {
    user = await User.create({
      name: cleanName,
      email: cleanEmail || undefined,
      username: cleanUsername || undefined,
      password: hashed,
      role: STAFF_BASE_ROLE,
      societyId,
      status: "active",
      isActive: true,
      sessionEpoch: 0,
      activeContext: { societyId: String(societyId), hat: "staff" },
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const field = Object.keys(err.keyPattern || {})[0] || "field";
      throw Object.assign(new Error(`That ${field} is already in use`), {
        code: `DUPLICATE_${String(field).toUpperCase()}`,
      });
    }
    throw err;
  }

  // ── assign the role (anti-escalation + audit + cache bump live here) ─────
  let assignment;
  try {
    const res = await assignRole({
      societyId,
      actorId,
      userId: String(user._id),
      roleId,
      expiresAt,
    });
    assignment = res.assignment;
  } catch (err) {
    // Roll back the half-created account so we never strand an orphan login
    // that has credentials but no role.
    await User.deleteOne({ _id: user._id }).catch(() => {});
    throw err;
  }

  await auditRbac({
    actorId,
    societyId,
    event: "USER_CREATED",
    after: {
      targetUserId: String(user._id),
      roleId: String(roleId),
      roleKey: role.key,
      via: "role-manager",
    },
  }).catch(() => {});

  return { user: publicUser(user), assignment };
}

export default { listSocietyUsers, createStaffUser };

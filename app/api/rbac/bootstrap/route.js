/**
 * POST /api/rbac/bootstrap
 * ----------------------------------------------------------------------------
 * One-time, admin-triggered activation of RBAC for a society that predates
 * (or was created outside) the seed-roles / backfill-assignments scripts.
 *
 * Gate: legacy JWT `role` field via requireRoles(["Admin"]) — deliberately NOT
 * an RBAC permission check (rbac.*), since a society with no seeded Role docs
 * can never satisfy one (chicken-and-egg). Safe because it is purely additive:
 *   - seeds the 4 system role templates for THIS society only (skips existing)
 *   - creates RoleAssignments for THIS society's legacy staff users who don't
 *     already have one (skips existing)
 *   - bumps Society.rbacVersion so perms caches rotate immediately
 * Idempotent: safe to call again (e.g. after adding new legacy staff).
 */

import { NextResponse } from "next/server";
import { requireRoles } from "@/lib/authz";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import Role from "@/models/Role";
import RoleAssignment from "@/models/RoleAssignment";
import User from "@/models/User";
import { registry } from "@/lib/rbac/registry";
import { SYSTEM_ROLE_DEFAULTS } from "@/lib/rbac/system-role-defaults";

const LEGACY_ROLE_TO_KEY = {
  Admin: "admin",
  Secretary: "secretary",
  Accountant: "accountant",
  Security: "security",
};

function expand(tokens) {
  const out = new Set();
  for (const t of tokens) {
    if (registry.has(t)) out.add(t);
    else registry.expand(t).forEach((id) => out.add(id));
  }
  return [...out];
}

export async function POST(request) {
  const auth = requireRoles(request, ["Admin"]);
  if (!auth.valid) return auth;
  const { societyId, userId } = auth.user;

  // Optional: seed only the chosen templates instead of all of them at once.
  // Omitting roleKeys (or an empty body) keeps the old one-click "seed
  // everything" behavior so existing callers (my-access "Enable Role
  // Management") don't need to change.
  let requestedKeys = null;
  try {
    const body = await request.json();
    if (Array.isArray(body?.roleKeys) && body.roleKeys.length) {
      requestedKeys = new Set(body.roleKeys);
    }
  } catch {
    /* no/empty body -> seed all, as before */
  }
  const defsToSeed = requestedKeys
    ? SYSTEM_ROLE_DEFAULTS.filter((d) => requestedKeys.has(d.key))
    : SYSTEM_ROLE_DEFAULTS;

  await connectDB();

  let templatesCreated = 0;
  for (const def of defsToSeed) {
    const existing = await Role.findOne({ societyId, key: def.key });
    if (existing) continue;
    await Role.create({
      societyId,
      key: def.key,
      name: def.name,
      description: def.description,
      color: def.color || null,
      isSystem: true,
      permissions: expand(def.permissions),
      denies: [],
      createdBy: userId,
      updatedBy: userId,
    });
    templatesCreated++;
  }

  const staff = await User.find({
    societyId,
    role: { $in: Object.keys(LEGACY_ROLE_TO_KEY) },
  })
    .select("_id role")
    .lean();

  let assignmentsCreated = 0;
  for (const u of staff) {
    const key = LEGACY_ROLE_TO_KEY[u.role];
    const role = await Role.findOne({ societyId, key }).select("_id key").lean();
    if (!role) continue;
    const exists = await RoleAssignment.findOne({
      userId: u._id,
      societyId,
      roleId: role._id,
    }).lean();
    if (exists) continue;
    await RoleAssignment.create({
      userId: u._id,
      societyId,
      roleId: role._id,
      roleKey: role.key,
      status: "active",
      assignedBy: userId,
    });
    assignmentsCreated++;
  }

  await Society.findByIdAndUpdate(societyId, { $inc: { rbacVersion: 1 } });

  return NextResponse.json({
    ok: true,
    templatesCreated,
    assignmentsCreated,
  });
}

// lib/rbac/seed-society-roles.js
//
// The one place "create this society's system role templates" happens. Used
// by:
//   - app/api/admin/societies/create/route.js  (new society, one admin)
//   - app/api/admin/bulk-import/route.js        (new society, bulk-imported)
//   - app/api/rbac/bootstrap/route.js           (manual re-seed / recovery UI)
//   - scripts/rbac/seed-roles.js                (one-off backfill across all)
//
// Before this existed, society creation only ever seeded the ADMIN template
// (via ensureAdminAssignment) — every other role (Secretary, Treasurer,
// Auditor, Security, Committee Member, Clubhouse Manager) had to be seeded by
// hand from the Roles & Permissions page later, which nobody did until they
// needed one. A new society now gets the full set immediately, so there's
// nothing left to remember to do.
//
// Same name-clash guard as the other two callers: a custom role with the
// exact template name (created by hand, before the template existed) is
// left alone instead of getting a confusing duplicate — see the incident
// this fixed, [[clubhouse-manager-duplicate]].

// Relative imports, not the "@/" alias — this file is imported both from
// Next.js routes (webpack resolves "@/" fine) and from plain `node
// scripts/rbac/seed-roles.js` (no bundler, no alias resolution at all).
import Role from "../../models/Role.js";
import { registry } from "./registry.js";
import { SYSTEM_ROLE_DEFAULTS } from "./system-role-defaults.js";

function expand(tokens) {
  const out = new Set();
  for (const t of tokens) {
    if (registry.has(t)) out.add(t);
    else registry.expand(t).forEach((id) => out.add(id));
  }
  return [...out];
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {string} societyId
 * @param {{ actorId?: string, roleKeys?: string[] }} [opts]
 *        roleKeys narrows to specific templates; omit to seed all of them.
 * @returns {Promise<{ created: string[], skippedExisting: string[], nameCollisions: {key,name,existingRoleId}[] }>}
 */
export async function seedAllRoleTemplatesForSociety(societyId, opts = {}) {
  const { actorId = null, roleKeys = null } = opts;
  const defs = roleKeys
    ? SYSTEM_ROLE_DEFAULTS.filter((d) => roleKeys.includes(d.key))
    : SYSTEM_ROLE_DEFAULTS;

  const created = [];
  const skippedExisting = [];
  const nameCollisions = [];

  for (const def of defs) {
    const existing = await Role.findOne({ societyId, key: def.key }).select("_id").lean();
    if (existing) {
      skippedExisting.push(def.key);
      continue;
    }
    const nameClash = await Role.findOne({
      societyId,
      isSystem: false,
      name: { $regex: `^${escapeRegExp(def.name)}$`, $options: "i" },
    }).lean();
    if (nameClash) {
      nameCollisions.push({ key: def.key, name: def.name, existingRoleId: String(nameClash._id) });
      continue;
    }
    await Role.create({
      societyId,
      key: def.key,
      name: def.name,
      description: def.description,
      color: def.color || null,
      isSystem: true,
      permissions: expand(def.permissions),
      denies: [],
      createdBy: actorId,
      updatedBy: actorId,
    });
    created.push(def.key);
  }

  return { created, skippedExisting, nameCollisions };
}

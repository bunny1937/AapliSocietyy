// lib/rbac/legacy-role-bridge.js
//
// Bridges a RoleAssignment's system-role key back to the legacy root `role`
// string, so a token minted from a RoleAssignment (the "staff hat" shape,
// { activeContext:{societyId,hat:"staff"} }) can ALSO satisfy the ~30 routes
// still gated by lib/authz.js's requireRoles(), which reads decoded.role
// directly and knows nothing about activeContext.
//
// Needed because of the Admin/Secretary/Accountant/Security login migration
// (see scripts/rbac/backfill-assignments.js + the deleted legacy branch in
// app/api/auth/login/route.js): those accounts used to mint a token with
// `role` set to the literal string. Once they log in via their RoleAssignment
// instead, the token has to keep carrying that string too, or every
// requireRoles()-gated route 403s them the moment this ships. This is
// additive, not a replacement — activeContext.hat is still the source of
// truth for authorize()/page-guard.js.
//
// Only the five keys that HAD a legacy string get one back. A pure-RBAC role
// (Auditor, Clubhouse Manager, Committee Member) never had a legacy string to
// restore, so it resolves to `undefined` and the token simply carries no
// `role` field for that hat — the same as before this bridge existed.
const KEY_TO_LEGACY_ROLE = {
  admin: "Admin",
  secretary: "Secretary",
  accountant: "Accountant",
  security: "Security",
};

/** @param {string} roleKey - RoleAssignment.roleKey / Role.key */
export function legacyRoleForKey(roleKey) {
  return KEY_TO_LEGACY_ROLE[roleKey] ?? undefined;
}

// lib/v1/staffRoleRoutes.js
//
// The ONE place in the backend that still knows a specific role by name.
// Everything else — label, which users hold it, which society — comes from
// RoleAssignment/Role in the database (see listActiveStaffRoles in
// lib/rbac/assignment-service.js). This map exists only because a role's
// mobile destination has to be an app route that ACTUALLY EXISTS in the
// Flutter build (lib/app/router.dart), and there is no way to invent that
// correspondence from data alone.
//
// Adding a new staff-role console to the mobile app means two things happen,
// in this order:
//   1. The Flutter app ships a screen and a GoRouter route for it.
//   2. One line gets added here: { <roleKey>: "<that route>" }.
// Nothing else in either codebase needs to change — GET /v1/auth/me starts
// including the new role in claims.roles automatically, and the app's
// profile-select / flat-switcher pickers render it as just another badge.
//
// A role key with NO entry here still appears in claims.staffRoles (so
// server-side authorization is unaffected), it just has no mobile console
// yet — GET /v1/auth/me's `roles` array omits it, same as if the client is
// too old to have that screen.
export const STAFF_ROLE_MOBILE_ROUTES = {
  clubhouseManager: "/clubhouse",
};

// Fallback for a role that never went through the exact key above — a custom
// role an admin typed by hand (e.g. "ClubHouse_manager", key
// "custom.clubhouse-manager.xxxxx"), or a system role a society renamed its
// own copy of. STAFF_ROLE_MOBILE_ROUTES alone silently drops those: same
// permissions, no mobile console, no error anywhere. Keyed by the ONE
// permission id each console's system template grants and nothing else does.
export const STAFF_CAPABILITY_MOBILE_ROUTES = [
  { permission: "amenities.clubhouse.operate", route: "/clubhouse" },
];

/**
 * Resolve a role's mobile console route: exact key match first (cheap, no
 * permission list needed), then capability fallback for roles that hold the
 * gating permission under any name.
 * @param {{ key:string, permissions?:string[] }} role
 * @returns {string|null}
 */
export function resolveStaffRoleRoute(role) {
  if (STAFF_ROLE_MOBILE_ROUTES[role.key]) return STAFF_ROLE_MOBILE_ROUTES[role.key];
  const perms = new Set(role.permissions || []);
  const match = STAFF_CAPABILITY_MOBILE_ROUTES.find((c) => perms.has(c.permission));
  return match?.route ?? null;
}

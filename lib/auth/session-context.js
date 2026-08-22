// Single source of truth for "what hat is this JWT authenticated as".
//
// 2026-08-22: /api/auth/me and /api/rbac/my-access each reimplemented this
// check independently, with different precedence. me.js checked
// decoded.role === "Admin" BEFORE decoded.activeContext.hat — but a modern
// staff-hat token carries BOTH (legacyRoleForKey bridges roleKey -> "Admin"
// for old requireRoles() routes). me.js took the legacy branch, re-fetched
// the user, and returned their ROOT User.role ("Member" for someone whose
// account is fundamentally a resident who also holds an Admin
// RoleAssignment) — while my-access, checking activeContext first, correctly
// resolved the same token to staff/Admin. Same cookie, two different
// answers. Every route that needs to know MEMBER vs STAFF for the active
// session must call getSessionContext() instead of re-deriving it from
// decoded.role / decoded.activeContext / decoded.activeProfileId inline —
// there is now exactly one place this precedence lives.
export const HAT_STAFF = "staff";
export const HAT_MEMBER = "member";

const LEGACY_STAFF_ROLES = ["Admin", "Secretary", "Accountant", "Security", "SOCIETY_ADMIN"];

/**
 * @returns {null | {
 *   hat: "staff" | "member",
 *   userId: string,
 *   societyId: string | null,
 *   role: string | null,
 *   memberId?: string,
 *   activeProfileId?: string,
 *   isLegacyToken: boolean,
 * }}
 */
export function getSessionContext(decoded) {
  if (!decoded?.userId) return null;

  // Modern staff-hat token — set by switch-profile/route.js. Checked FIRST:
  // it's the most specific signal, and (unlike decoded.role) can't be
  // ambiguous with a legacy token shape.
  if (decoded.activeContext?.hat === HAT_STAFF) {
    return {
      hat: HAT_STAFF,
      userId: decoded.userId,
      societyId: decoded.activeContext.societyId || null,
      role: decoded.role || null,
      isLegacyToken: false,
    };
  }

  // Modern member token — set by switch-profile/route.js and login CASE A/B.
  if (decoded.activeProfileId) {
    return {
      hat: HAT_MEMBER,
      userId: decoded.userId,
      societyId: decoded.societyId || null,
      role: decoded.role || null,
      memberId: decoded.memberId,
      activeProfileId: decoded.activeProfileId,
      isLegacyToken: false,
    };
  }

  // Legacy pre-RBAC hardcoded-role token — no activeContext, no
  // activeProfileId, so decoded.role is the only signal it carries.
  if (LEGACY_STAFF_ROLES.includes(decoded.role)) {
    return {
      hat: HAT_STAFF,
      userId: decoded.userId,
      societyId: decoded.societyId || null,
      role: decoded.role,
      isLegacyToken: true,
    };
  }
  if (decoded.role === "Member") {
    return {
      hat: HAT_MEMBER,
      userId: decoded.userId,
      societyId: decoded.societyId || null,
      role: decoded.role,
      memberId: decoded.memberId || null,
      isLegacyToken: true,
    };
  }

  return null;
}

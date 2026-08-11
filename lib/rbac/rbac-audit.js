/**
 * ============================================================================
 * AapliSociety RBAC — Audit helpers
 * ============================================================================
 * Thin wrappers over the existing immutable audit logger (lib/audit-logger.js:
 * logAudit(userId, societyId, action, oldData, newData)). Centralizing the
 * RBAC event names here keeps them consistent and greppable. Every role,
 * assignment, permission, and access-lifecycle change MUST be audited (Q6/Q11).
 * ============================================================================
 */

import { logAudit } from "@/lib/audit-logger";

export const RBAC_EVENTS = Object.freeze({
  ROLE_CREATED: "ROLE_CREATED",
  ROLE_UPDATED: "ROLE_UPDATED",
  ROLE_DELETED: "ROLE_DELETED",
  ROLE_CLONED: "ROLE_CLONED",
  ROLE_DEFAULTS_RESTORED: "ROLE_DEFAULTS_RESTORED",
  ROLE_ASSIGNED: "ROLE_ASSIGNED",
  ROLE_UNASSIGNED: "ROLE_UNASSIGNED",
  PERMISSION_GRANTED: "PERMISSION_GRANTED",
  PERMISSION_REVOKED: "PERMISSION_REVOKED",
  USER_SUSPENDED: "USER_SUSPENDED",
  USER_REACTIVATED: "USER_REACTIVATED",
  CONTEXT_SWITCHED: "CONTEXT_SWITCHED",
  AUTHZ_DENIED: "AUTHZ_DENIED",
});

/**
 * @param {object} p
 * @param {string} p.actorId    - who performed the action
 * @param {string} p.societyId  - tenant scope
 * @param {string} p.event      - one of RBAC_EVENTS
 * @param {object} [p.before]   - prior state snapshot
 * @param {object} [p.after]    - new state snapshot
 */
export async function auditRbac({
  actorId,
  societyId,
  event,
  before = null,
  after = null,
}) {
  try {
    await logAudit(actorId, societyId, event, before, after);
  } catch (err) {
    // Auditing must never crash the mutation, but failures must be visible.
    console.error(`[rbac-audit] failed to record ${event}:`, err?.message);
  }
}

/** Record a denied access attempt for security monitoring (Q10). */
export async function auditDenied({
  actorId,
  societyId,
  requiredPermission,
  path,
  hat,
}) {
  await auditRbac({
    actorId,
    societyId,
    event: RBAC_EVENTS.AUTHZ_DENIED,
    after: { requiredPermission, path, hat },
  });
}

// ============================================================================
// Named convenience wrappers (Phase 2 additive extension — no change to the
// existing auditRbac/auditDenied behaviour). Each records one RBAC_EVENTS entry
// with a consistent before/after snapshot shape.
// ============================================================================

const roleSnap = (role) =>
  role
    ? {
        roleId: String(role._id || role.id || ""),
        key: role.key,
        name: role.name,
        isSystem: role.isSystem,
      }
    : null;

export const auditRoleCreated = ({ actorId, societyId, role }) =>
  auditRbac({
    actorId,
    societyId,
    event: RBAC_EVENTS.ROLE_CREATED,
    after: roleSnap(role),
  });

export const auditRoleCloned = ({ actorId, societyId, role, clonedFromKey }) =>
  auditRbac({
    actorId,
    societyId,
    event: RBAC_EVENTS.ROLE_CLONED,
    after: { ...roleSnap(role), clonedFromKey },
  });

export const auditRoleUpdated = ({
  actorId,
  societyId,
  role,
  added = [],
  removed = [],
}) =>
  auditRbac({
    actorId,
    societyId,
    event: RBAC_EVENTS.ROLE_UPDATED,
    before: { ...roleSnap(role), removed },
    after: { ...roleSnap(role), added },
  });

export const auditRoleDeleted = ({
  actorId,
  societyId,
  role,
  affectedUserIds = [],
}) =>
  auditRbac({
    actorId,
    societyId,
    event: RBAC_EVENTS.ROLE_DELETED,
    before: { ...roleSnap(role), affectedUserIds },
  });

export const auditDefaultsRestored = ({ actorId, societyId, role }) =>
  auditRbac({
    actorId,
    societyId,
    event: RBAC_EVENTS.ROLE_DEFAULTS_RESTORED,
    after: roleSnap(role),
  });

export const auditRoleAssigned = ({ actorId, societyId, userId, role }) =>
  auditRbac({
    actorId,
    societyId,
    event: RBAC_EVENTS.ROLE_ASSIGNED,
    after: { targetUserId: String(userId), role: roleSnap(role) },
  });

export const auditRoleUnassigned = ({ actorId, societyId, userId, role }) =>
  auditRbac({
    actorId,
    societyId,
    event: RBAC_EVENTS.ROLE_UNASSIGNED,
    before: { targetUserId: String(userId), role: roleSnap(role) },
  });

export const auditUserSuspended = ({
  actorId,
  societyId,
  userId,
  reason = null,
}) =>
  auditRbac({
    actorId,
    societyId,
    event: RBAC_EVENTS.USER_SUSPENDED,
    after: { targetUserId: String(userId), reason },
  });

export const auditUserReactivated = ({ actorId, societyId, userId }) =>
  auditRbac({
    actorId,
    societyId,
    event: RBAC_EVENTS.USER_REACTIVATED,
    after: { targetUserId: String(userId) },
  });

export const auditContextSwitched = ({ actorId, societyId, hat }) =>
  auditRbac({
    actorId,
    societyId,
    event: RBAC_EVENTS.CONTEXT_SWITCHED,
    after: { societyId, hat },
  });

export default {
  RBAC_EVENTS,
  auditRbac,
  auditDenied,
  auditRoleCreated,
  auditRoleCloned,
  auditRoleUpdated,
  auditRoleDeleted,
  auditDefaultsRestored,
  auditRoleAssigned,
  auditRoleUnassigned,
  auditUserSuspended,
  auditUserReactivated,
  auditContextSwitched,
};

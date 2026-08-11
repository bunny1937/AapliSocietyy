/**
 * ============================================================================
 * AapliSociety RBAC — authorize(): the deny-by-default API route guard
 * ============================================================================
 * The ONLY authority a route needs. Usage:
 *
 *   import { authorize } from "@/lib/rbac/authorize";
 *   export async function POST(request) {
 *     const gate = await authorize(request, "billing.bill.generate");
 *     if (!gate.ok) return gate.response;      // 401 / 403 already built
 *     const { userId, societyId, hat } = gate.context;
 *     ...
 *   }
 *
 * Guarantees:
 *   - Backend is the source of truth (never trusts client-sent role/society).
 *   - Deny-by-default: anything unproven is denied.
 *   - Session freshness (Q11): token.sessionEpoch must match the user's current
 *     epoch, else 401 -> forced re-auth (privilege reduction invalidates it).
 *   - Structured 403 payload (Q10) so the client can route to /my-access.
 *   - Every denial is audited (AUTHZ_DENIED).
 * ============================================================================
 */

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { getTokenFromRequest, verifyToken, isMemberToken } from "@/lib/jwt";
import {
  resolveEffectivePermissions,
  can,
  HAT,
} from "@/lib/rbac/permission-engine";
import { auditDenied } from "@/lib/rbac/rbac-audit";

function unauthorized(message = "Authentication required") {
  return NextResponse.json(
    { error: message, code: "UNAUTHENTICATED", reauth: true },
    { status: 401 },
  );
}

function forbidden({ requiredPermission, activeContext }) {
  // Structured payload (Q10): client shows / routes to "My Roles & Permissions".
  return NextResponse.json(
    {
      error: "You don't have permission to perform this action.",
      code: "FORBIDDEN",
      requiredPermission,
      activeContext,
      redirectTo: "/my-access",
      contactAdmin: true,
    },
    { status: 403 },
  );
}

/**
 * Resolve the ACTIVE context from a verified token (never trust client body).
 * Handles new RBAC tokens, legacy staff tokens, and legacy/member tokens.
 * @returns {{ userId:string, societyId:string|null, hat:string }|null}
 */
function resolveContext(decoded) {
  if (!decoded) return null;
  const userId = decoded.userId || decoded.sub || decoded.id;
  if (!userId) return null;

  // New RBAC token shape: { userId, activeContext:{ societyId, hat }, sessionEpoch }
  if (decoded.activeContext?.societyId) {
    return {
      userId,
      societyId: decoded.activeContext.societyId,
      hat: decoded.activeContext.hat === HAT.MEMBER ? HAT.MEMBER : HAT.STAFF,
    };
  }

  // Legacy MEMBER token: { role:"Member", societyId, memberId } OR { activeProfileId }
  if (
    isMemberToken?.(decoded) ||
    decoded.role === "Member" ||
    decoded.activeProfileId
  ) {
    return { userId, societyId: decoded.societyId || null, hat: HAT.MEMBER };
  }

  // Legacy STAFF token: { role, societyId }
  if (decoded.role && decoded.societyId) {
    return { userId, societyId: decoded.societyId, hat: HAT.STAFF };
  }

  return { userId, societyId: decoded.societyId || null, hat: HAT.STAFF };
}

/**
 * @param {Request} request
 * @param {string} requiredPermission - a concrete leaf id, e.g. "billing.bill.generate"
 * @param {{ allowMember?:boolean }} [opts]
 * @returns {Promise<{ok:true, context:object} | {ok:false, response:NextResponse}>}
 */
export async function authorize(request, requiredPermission, opts = {}) {
  const resolved = await resolveAuthenticatedContext(request);
  if (!resolved.ok) return resolved;
  const { context, permSet } = resolved;

  if (!can(permSet, requiredPermission)) {
    await auditDenied({
      actorId: context.userId,
      societyId: context.societyId,
      requiredPermission,
      path: new URL(request.url).pathname,
      hat: context.hat,
    });
    return {
      ok: false,
      response: forbidden({
        requiredPermission,
        activeContext: { societyId: context.societyId, hat: context.hat },
      }),
    };
  }

  return { ok: true, context: { ...context, permissions: permSet } };
}

/**
 * Same guarantees as authorize(), but passes if the caller holds ANY one of
 * several permission ids — for routes genuinely shared by more than one page
 * (e.g. a "financial years" list every Financial Statements page needs,
 * regardless of which specific one the caller was granted).
 * @param {Request} request
 * @param {string[]} requiredPermissionIds
 */
export async function authorizeAny(request, requiredPermissionIds) {
  const resolved = await resolveAuthenticatedContext(request);
  if (!resolved.ok) return resolved;
  const { context, permSet } = resolved;

  const matched = requiredPermissionIds.find((id) => can(permSet, id));
  if (!matched) {
    await auditDenied({
      actorId: context.userId,
      societyId: context.societyId,
      requiredPermission: requiredPermissionIds.join(" | "),
      path: new URL(request.url).pathname,
      hat: context.hat,
    });
    return {
      ok: false,
      response: forbidden({
        requiredPermission: requiredPermissionIds[0],
        activeContext: { societyId: context.societyId, hat: context.hat },
      }),
    };
  }

  return { ok: true, context: { ...context, permissions: permSet } };
}

/** Shared by authorize()/authorizeAny(): token verify, session-freshness, effective perms. */
async function resolveAuthenticatedContext(request) {
  const token = getTokenFromRequest(request);
  if (!token) return { ok: false, response: unauthorized() };

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch {
    return { ok: false, response: unauthorized("Invalid or expired session") };
  }
  if (!decoded)
    return { ok: false, response: unauthorized("Invalid or expired session") };

  const context = resolveContext(decoded);
  if (!context?.userId || !context.societyId) {
    return { ok: false, response: unauthorized("No active society context") };
  }

  // ── Session freshness (Q11): reject tokens issued before a privilege change ──
  try {
    await connectDB();
    const user = await User.findById(context.userId)
      .select("sessionEpoch status")
      .lean();
    if (!user)
      return { ok: false, response: unauthorized("Account not found") };
    if (user.status === "suspended") {
      return { ok: false, response: unauthorized("Account suspended") };
    }
    const currentEpoch = user.sessionEpoch || 0;
    const tokenEpoch = decoded.sessionEpoch || 0;
    if (tokenEpoch < currentEpoch) {
      // Token predates a privilege reduction => force re-authentication.
      return {
        ok: false,
        response: unauthorized("Your access changed. Please sign in again."),
      };
    }
  } catch (err) {
    // Fail-closed on any freshness check error.
    console.error(
      "[rbac] authorize freshness check failed (fail-closed):",
      err?.message,
    );
    return { ok: false, response: unauthorized("Session validation failed") };
  }

  // ── Effective-permission check (deny-by-default) ────────────────────────────
  const permSet = await resolveEffectivePermissions({
    userId: context.userId,
    societyId: context.societyId,
    hat: context.hat,
  });

  return { ok: true, context: { ...context, decoded }, permSet };
}

/** Higher-order wrapper for concise route definitions. */
export function withAuthorization(requiredPermission, handler, opts = {}) {
  return async function (request, routeCtx) {
    const gate = await authorize(request, requiredPermission, opts);
    if (!gate.ok) return gate.response;
    return handler(request, { ...routeCtx, rbac: gate.context });
  };
}

export default authorize;

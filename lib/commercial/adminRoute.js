// Route wrapper for the ADMIN (website) commercial endpoints under
// /api/commercial/*. It reuses the existing cookie/bearer admin JWT
// (lib/jwt.js) and the existing role list (lib/v1/constants.js) — no new auth
// system, no new session store.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { ROLES, SOCIETY_ADMIN_ROLES } from "@/lib/v1/constants";
import { CommercialError } from "./errors";
import { loadCommercialFlags } from "./featureFlags";
import { logCommercial, readRequestId } from "./logging";
import { authorize, authorizeAny } from "@/lib/rbac/authorize";

const ALLOWED_ROLES = [...SOCIETY_ADMIN_ROLES, ROLES.SUPER_ADMIN];

/**
 * @param {string} operation  short operation name used in logs
 * @param {(ctx) => Promise<any>} handler
 * @param {{ requireFlag?: "enabled"|"directoryEnabled"|"ownerEditingEnabled"|"commercialBillingEnabled", skipAuthorize?: boolean, extraViewIds?: string[] }} options
 *   extraViewIds: additional permission ids that also satisfy a GET here —
 *   for endpoints read from OTHER pages too (cross-page dependency), not
 *   just the Commercial admin page.
 */
export function adminCommercialRoute(operation, handler, options = {}) {
  return async (req, routeCtx) => {
    const requestId = readRequestId(req);
    const startedAt = Date.now();
    let societyId;
    try {
      await connectDB();

      const token = getTokenFromRequest(req);
      if (!token) throw new CommercialError(401, "Unauthorized", "NO_TOKEN");
      const decoded = verifyToken(token);
      if (!decoded) throw new CommercialError(401, "Invalid token", "BAD_TOKEN");
      // Legacy ALLOWED_ROLES check removed as a blocking gate: it only knew
      // the literal old role strings and 403'd every RBAC-only staff role
      // (e.g. Auditor) outright, before the real RBAC check below even ran.
      // RBAC is now the actual gate — the caller's active RoleAssignment
      // must grant the "Commercial" page, at the level this method needs.
      const level = req.method === "GET" ? "view" : "update";
      // Some GET endpoints (module-enabled flags) are read by every staff
      // role for sidebar/module discovery, not just commercial admins —
      // those pass skipAuthorize and only need a valid session below.
      let gateSocietyId = null;
      if (!options.skipAuthorize) {
        const ids =
          level === "view" && options.extraViewIds?.length
            ? [`commercial.admin.${level}`, ...options.extraViewIds]
            : [`commercial.admin.${level}`];
        const gate =
          ids.length > 1 ? await authorizeAny(req, ids) : await authorize(req, ids[0]);
        if (!gate.ok) return gate.response;
        gateSocietyId = gate.context.societyId;
      }
      // Tenant scope always comes from the verified token, never the body.
      societyId = decoded.societyId || decoded.activeContext?.societyId || gateSocietyId;
      if (!societyId) throw new CommercialError(403, "No society scope", "NO_SCOPE");
      const userId = decoded.userId || decoded.id || decoded._id || null;

      const flags = await loadCommercialFlags(societyId);
      const requiredFlag = "requireFlag" in options ? options.requireFlag : "enabled";
      if (requiredFlag && !flags[requiredFlag]) {
        throw new CommercialError(
          403,
          "Commercial features are not enabled for this society",
          "FEATURE_DISABLED",
        );
      }

      const params = (await routeCtx?.params) ?? {};
      const result = await handler({ req, societyId, userId, role: decoded.role, flags, params, requestId });
      const res =
        result instanceof NextResponse
          ? result
          : NextResponse.json({ success: true, ...result });
      res.headers.set("x-request-id", requestId);
      logCommercial({
        level: "info",
        requestId,
        operation,
        societyId: String(societyId),
        method: req.method,
        statusCode: res.status,
        durationMs: Date.now() - startedAt,
      });
      return res;
    } catch (err) {
      const status = err instanceof CommercialError ? err.status : 500;
      logCommercial({
        level: status >= 500 ? "error" : "warn",
        requestId,
        operation,
        societyId: societyId ? String(societyId) : undefined,
        method: req.method,
        statusCode: status,
        durationMs: Date.now() - startedAt,
        errorCode: err?.code || err?.name || "Error",
        message: typeof err?.message === "string" ? err.message.slice(0, 200) : undefined,
      });
      const body =
        err instanceof CommercialError ? err.body : { error: "Internal server error" };
      return NextResponse.json(body, { status, headers: { "x-request-id": requestId } });
    }
  };
}

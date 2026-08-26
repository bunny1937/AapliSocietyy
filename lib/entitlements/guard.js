import { NextResponse } from "next/server";
import { verifyAccess } from "@/lib/v1/jwt";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import { loadEntitlements } from "./resolve";
import { getModule, isNeverGated } from "./modules";

// The server-side gate. Everything else — hidden sidebars, absent pages, an
// app that never renders the tab — is convenience. This is the part that
// actually holds.
//
// ## The attacker this is for
//
// Not the admin who types /admin/amenities out of curiosity; hiding the nav
// handles them. The one worth engineering for is the admin who opens devtools,
// finds /api/v1/amenities/list in a bundle, and calls it with a completely
// valid session. They are properly authenticated. The question is not *who are
// you* but *what did your society buy*, and only a server check can answer it.
//
// ## Why 404 and not 403
//
// A 403 says "this exists and you cannot have it" — a product catalogue for
// anyone mapping the platform. A 404 says nothing.
//
// The cost is that support will one day stare at a 404 on a route that plainly
// exists. Two mitigations: every denial is logged, and X-Denied-Reason is
// emitted — but only to a superadmin, so nobody else can tell it apart from a
// genuine miss.

/** Deliberately indistinguishable from a real 404. */
const NOT_FOUND_BODY = { error: "Not found" };

/**
 * Society and role from whichever token the caller presented.
 *
 * Two auth systems are in play: /v1 is bearer-only with `verifyAccess`, while
 * the legacy /api surface reads a cookie with `verifyToken`. A guard that
 * understood only one would silently pass every request on the other, which is
 * the failure mode that matters here — it fails open.
 */
export function identifyRequest(req) {
  const authHeader = req.headers?.get?.("authorization");
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    try {
      const claims = verifyAccess(authHeader.replace(/^Bearer\s+/i, ""));
      return {
        societyId: claims.societyId || claims.activeContext?.societyId || null,
        userId: claims.userId || claims.sub || null,
        role: claims.role || null,
        source: "v1",
      };
    } catch {
      /* fall through — an unreadable bearer is the route guard's problem */
    }
  }
  try {
    const token = getTokenFromRequest(req);
    if (token) {
      const decoded = verifyToken(token);
      if (decoded) {
        return {
          societyId: decoded.activeContext?.societyId || decoded.societyId || null,
          userId: decoded.userId || decoded.sub || decoded.id || null,
          role: decoded.role || null,
          source: "legacy",
        };
      }
    }
  } catch {
    /* same */
  }
  return { societyId: null, userId: null, role: null, source: "none" };
}

function deny(req, { module: mod, identity, pathname }) {
  // Phase 3 replaces this with a persistent record plus thresholded alerting.
  // Until then it still has to be visible somewhere, or the first support call
  // about a mystery 404 has nothing to look at.
  console.warn(
    `[entitlement] denied ${pathname} — society=${identity.societyId} module=${mod?.key} user=${identity.userId}`,
  );

  const res = NextResponse.json(NOT_FOUND_BODY, { status: 404 });
  // Only a superadmin learns why. To everyone else this is a plain 404.
  if (identity.role === "SuperAdmin") {
    res.headers.set("X-Denied-Reason", `entitlement:${mod?.key || "unknown"}`);
  }
  return res;
}

/**
 * Wrap a route handler so it 404s unless the caller's society holds the module.
 *
 *     export const GET = withRoute(requireModule("amenities", async (req) => …));
 *
 * Works with both `withRoute` handlers and plain Next handlers, because it
 * returns a Response either way rather than throwing — `withRoute` passes a
 * returned Response straight through.
 *
 * A request with no identifiable society is denied. That is deliberate: an
 * unauthenticated caller has no entitlement, and letting it through "for the
 * route's own auth to reject" would mean the gate depends on every downstream
 * handler getting its own auth right.
 */
export function requireModule(moduleKey, handler) {
  const mod = getModule(moduleKey);
  if (!mod) {
    throw new Error(
      `requireModule("${moduleKey}") — no such module. Add it to lib/entitlements/modules.js.`,
    );
  }

  return async function guarded(req, ctx) {
    const pathname = (() => {
      try {
        return new URL(req.url).pathname;
      } catch {
        return "";
      }
    })();

    // A never-gated path that somehow reached a guarded handler is a registry
    // mistake, not a request to refuse.
    if (isNeverGated(pathname)) return handler(req, ctx);

    const identity = identifyRequest(req);
    if (!identity.societyId) return deny(req, { module: mod, identity, pathname });

    const { modules } = await loadEntitlements(identity.societyId);
    if (modules[moduleKey] !== true) {
      return deny(req, { module: mod, identity, pathname });
    }
    return handler(req, ctx);
  };
}

/**
 * The same check for a handler that already knows its society — a /v1 route
 * that has called getClaims/requireTenant and does not want the token parsed
 * twice.
 *
 * Returns a 404 Response when denied, null when allowed, so the caller writes:
 *
 *     const denied = await denyUnlessModule(societyId, "amenities", req);
 *     if (denied) return denied;
 */
export async function denyUnlessModule(societyId, moduleKey, req) {
  const mod = getModule(moduleKey);
  if (!societyId) {
    return deny(req, { module: mod, identity: { societyId: null }, pathname: "" });
  }
  const { modules } = await loadEntitlements(societyId);
  if (modules[moduleKey] === true) return null;
  const identity = identifyRequest(req);
  return deny(req, { module: mod, identity, pathname: "" });
}

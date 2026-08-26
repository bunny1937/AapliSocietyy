// Auth helpers for /v1 route handlers. Next.js route handlers aren't Express
// middleware, so instead of requireAuth/withTenant middleware these are
// called at the top of each handler and throw ApiError on failure.
import { ApiError } from "./http";
import { verifyAccess } from "./jwt";

function readToken(req) {
  // SEC-10: bearer-only, by design — v1 is exempted from the Origin/CSRF
  // check in middleware.js on that premise. No web caller was found using
  // the cookie fallback that used to exist here; a browser could otherwise
  // authenticate the whole v1 write surface by cookie with no Origin check.
  const authHeader = req.headers.get("authorization");
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^Bearer\s+/i, "");
  }
  return undefined;
}

// Verify the access token and return its claims. Mirrors mobile-backend's
// requireAuth: rejects pending (profile-not-chosen) tokens and, outside the
// auth routes, rejects tokens flagged mustChangePassword.
export function getClaims(req, { allowPending = false, allowMustChange = false } = {}) {
  const token = readToken(req);
  if (!token) throw new ApiError(401, "No token");
  let claims;
  try {
    claims = verifyAccess(token);
  } catch {
    throw new ApiError(401, "Invalid token");
  }
  if (!allowPending && claims.pending) throw new ApiError(403, "Profile selection required");
  if (!allowMustChange && claims.mustChangePassword) throw new ApiError(403, "Password change required");
  return claims;
}

export function requireRoles(claims, roles) {
  if (!roles.includes(claims.role)) throw new ApiError(403, "Forbidden");
}

// Returns the societyId scope from the verified token (never from the client
// body). Mirrors mobile-backend's withTenant.
export function requireTenant(claims) {
  if (!claims.societyId) throw new ApiError(403, "No society scope");
  return claims.societyId;
}

// Client IP for rate-limit / audit purposes.
export function clientIp(req) {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

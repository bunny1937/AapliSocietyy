// middleware.js
import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import cache from "@/lib/cache";
import { getSessionEpochFloor } from "@/lib/session-epoch";
const ALLOWED_ORIGIN =
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
// Extra CSRF-allowed origins (comma-separated). Use for tunnels like ngrok.
// e.g. ALLOWED_ORIGINS="https://nguyet-diffusible-madonna.ngrok-free.dev"
const EXTRA_ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
async function parseJwt(t, secretEnvKey = "JWT_SECRET") {
  try {
    const secret = new TextEncoder().encode(process.env[secretEnvKey]);
    const { payload } = await jwtVerify(t, secret);
    return payload;
  } catch {
    return null;
  }
}
// Single choke point for the logout/session-revocation denylist (see
// app/api/auth/logout and app/api/v1/auth/logout, which write
// revoked:jti:<jti>). Both lib/authz.js's requireAuth (123 legacy routes)
// and lib/rbac/authorize.js call verifyToken() but neither reads this key,
// so without this check a "logged out" token stayed valid for up to 7 days.
// jose + lib/cache.js (Upstash REST) are both edge-safe, so this runs before
// any route handler regardless of runtime.
async function isRevoked(payload) {
  if (!payload?.jti) return false;
  return Boolean(await cache.get(`revoked:jti:${payload.jti}`));
}
// Session-freshness backstop (Q11 in lib/rbac/session.js): rejects any token
// whose sessionEpoch predates a privilege reduction / suspendUser() call,
// even on the 123 routes still guarded by the legacy lib/authz.js (which
// never re-checks role/status per request). Sourced from the Redis floor
// lib/rbac/session.js.bumpSessionEpoch writes — no Mongo access needed here.
async function isStaleSession(payload) {
  const userId = payload?.userId || payload?.sub || payload?.id;
  if (!userId) return false;
  const floor = await getSessionEpochFloor(userId);
  if (floor === null) return false; // nothing ever bumped for this user — nothing to enforce
  const tokenEpoch = payload.sessionEpoch || 0;
  return tokenEpoch < floor;
}
function extractBearerToken(request) {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}
export async function middleware(request) {
  const { pathname } = request.nextUrl;
  const method = request.method;
  // API routes: CSRF check, then a revocation check, then pass through —
  // never redirect to a login page (routes own their 401/403 shape).
  if (pathname.startsWith("/api/")) {
    // /api/v1/* is the bearer-token mobile API — no cookies involved, so
    // there's nothing for a CSRF/Origin check to protect. Enforcing it here
    // only blocks legitimate native-app requests, which don't send Origin.
    const isUnsafeMethod =
      !pathname.startsWith("/api/v1/") &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(method);
    if (isUnsafeMethod) {
      const origin = request.headers.get("origin");
      // Non-production only: allow Playwright APIRequestContext which sends no Origin.
      // Double-gated: NODE_ENV check ensures this path is dead in production even if
      // an attacker crafts x-test-mode header.
      const isTestBypass =
        process.env.NODE_ENV !== "production" &&
        request.headers.get("x-test-mode") === "true";
      // Allowed origins: the canonical app URL + any explicit extras.
      const allowedOrigins = [ALLOWED_ORIGIN, ...EXTRA_ALLOWED_ORIGINS];
      // DEV ONLY: also accept same-origin requests (Origin host === Host header).
      // Lets you tunnel via ngrok / LAN IP on mobile without hardcoding URLs.
      // Hard-disabled in production.
      let isSameOriginDev = false;
      if (process.env.NODE_ENV !== "production" && origin) {
        try {
          isSameOriginDev =
            new URL(origin).host === request.headers.get("host");
        } catch {
          isSameOriginDev = false;
        }
      }
      const originOk =
        !!origin && (allowedOrigins.includes(origin) || isSameOriginDev);
      if (!isTestBypass && !originOk) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    // Revocation check: only runs when a "token" (regular JWT_SECRET) is
    // actually presented, via cookie (web) or Bearer header (mobile/API
    // clients). No token / an already-invalid token is left for the route's
    // own auth guard to reject as today.
    const apiToken =
      request.cookies.get("token")?.value || extractBearerToken(request);
    if (apiToken) {
      const payload = await parseJwt(apiToken);
      if (await isRevoked(payload)) {
        return NextResponse.json({ error: "Token revoked" }, { status: 401 });
      }
      if (await isStaleSession(payload)) {
        return NextResponse.json(
          { error: "Your access changed. Please sign in again.", code: "UNAUTHENTICATED", reauth: true },
          { status: 401 },
        );
      }
    }
    return NextResponse.next();
  }
  const token = request.cookies.get("token")?.value;
  const adminToken = request.cookies.get("admin_token")?.value;
  // ── PUBLIC ROUTES ─────────────────────────────────────────────────────────
  const publicRoutes = [
    "/auth/login",
    "/auth/signup",
    "/admin/login",
    "/security/login",
    "/member/login",
    "/superadmin/login",
    "/onboarding",
  ];
  if (publicRoutes.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }
  // ── ROOT REDIRECT ─────────────────────────────────────────────────────────
  if (pathname === "/") {
    if (adminToken) {
      const adminPayload = await parseJwt(adminToken, "ADMIN_JWT_SECRET");
      if (adminPayload?.role === "SuperAdmin") {
        return NextResponse.redirect(
          new URL("/superadmin/dashboard", request.url),
        );
      }
    }
    if (token) {
      const payload = await parseJwt(token);
      if (payload?.role === "Security") {
        return NextResponse.redirect(
          new URL("/security/dashboard", request.url),
        );
      }
      if (
        payload?.role === "Admin" ||
        payload?.role === "Secretary" ||
        payload?.role === "Accountant"
      ) {
        return NextResponse.redirect(new URL("/admin/dashboard", request.url));
      }
      // RBAC-only staff role (e.g. Auditor) — no legacy role string, and may
      // not hold Dashboard access. /my-access always works.
      if (payload?.activeContext?.hat === "staff") {
        return NextResponse.redirect(new URL("/my-access", request.url));
      }
      // Member token: new shape has activeProfileId, no role
      // Old shape: role === "Member"
      if (payload?.activeProfileId || payload?.role === "Member") {
        return NextResponse.redirect(new URL("/member/dashboard", request.url));
      }
    }
    return NextResponse.next();
  }
  // ── SUPERADMIN ROUTES ─────────────────────────────────────────────────────
  if (pathname.startsWith("/superadmin")) {
    if (!adminToken) {
      return NextResponse.redirect(new URL("/superadmin/login", request.url));
    }
    const adminPayload = await parseJwt(adminToken, "ADMIN_JWT_SECRET");
    if (!adminPayload || adminPayload.role !== "SuperAdmin") {
      return NextResponse.redirect(new URL("/superadmin/login", request.url));
    }
    return NextResponse.next();
  }
  // ── ADMIN + MEMBER PROTECTED ROUTES ──────────────────────────────────────
  if (!token) {
    if (pathname.startsWith("/security")) {
      return NextResponse.redirect(new URL("/auth/login", request.url));
    }
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }
  const payload = await parseJwt(token);
  if (!payload || (await isRevoked(payload)) || (await isStaleSession(payload))) {
    if (pathname.startsWith("/security")) {
      return NextResponse.redirect(new URL("/auth/login", request.url));
    }
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }
  // Determine effective role:
  // - Admin/Secretary: payload.role present
  // - Member (new JWT): payload.activeProfileId present, no role
  // - Member (old JWT): payload.role === "Member"
  // - RBAC staff-hat (new JWT, from a RoleAssignment-backed profile, e.g. a
  //   member who was also granted "Auditor"): payload.activeContext.hat==="staff",
  //   no legacy role string at all. This is only a coarse, edge-safe gate
  //   (no DB access here) — the real per-page permission check still happens
  //   in lib/rbac/page-guard.js's requirePagePermission().
  const isAdmin =
    payload.role === "Admin" ||
    payload.role === "Secretary" ||
    payload.role === "Accountant" ||
    payload.role === "SOCIETY_ADMIN" ||
    payload.activeContext?.hat === "staff";
  const isMember = payload.role === "Member" || !!payload.activeProfileId;
  const isSecurity = payload.role === "Security";
  // /admin exact → redirect to dashboard
  if (pathname === "/admin") {
    return NextResponse.redirect(new URL("/admin/dashboard", request.url));
  }
  if (pathname === "/security")
    return NextResponse.redirect(new URL("/security/dashboard", request.url));
  if (pathname.startsWith("/admin") && !isAdmin) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }
  if (pathname.startsWith("/member") && !isMember) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }
  if (pathname.startsWith("/security") && !isSecurity) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }
  return NextResponse.next();
}
export const config = {
  matcher: [
    "/",
    "/admin/:path*",
    "/member/:path*",
    "/security/:path*",
    "/superadmin/:path*",
    "/api/:path*",
  ],
};

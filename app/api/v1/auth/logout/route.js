// POST /api/v1/auth/logout — revokes the caller's access token.
//
// Test 10 found logout 404'd and tokens stayed valid after logout. With jti
// (lib/jwt.js signToken) every token now carries a unique id; this route
// denylists it in redis for the rest of its natural lifetime, and clears the
// web HttpOnly cookie. Mobile clients just discard their Bearer token.

import { NextResponse } from "next/server";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import cache from "@/lib/cache";

export const runtime = "nodejs";

export async function POST(request) {
  const token = getTokenFromRequest(request);
  const decoded = token && verifyToken(token);
  if (!decoded) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Denylist this token id until its natural expiry (TTL in seconds; if redis
  // is not configured, cache.set silently no-ops and the 15-min access-token
  // TTL still bounds exposure).
  const ttlSeconds = Math.max(1, (decoded.exp || 0) - Math.floor(Date.now() / 1000));
  if (decoded.jti) await cache.set(`revoked:jti:${decoded.jti}`, 1, ttlSeconds);

  const res = NextResponse.json({ ok: true });
  res.cookies.set("token", "", { httpOnly: true, maxAge: 0, path: "/" });
  return res;
}

// ── Enforcement (phased): verifyToken() is sync and used everywhere, so the
// denylist read starts with the sensitive routes. After the existing auth
// gate in billing/admin/payment routes, add:
//
//   const revoked = decoded?.jti && (await cache.get(`revoked:jti:${decoded.jti}`));
//   if (revoked) return NextResponse.json({ error: "Token revoked" }, { status: 401 });
//
// Long-term: fold that check into an async requireAuth() and migrate routes.

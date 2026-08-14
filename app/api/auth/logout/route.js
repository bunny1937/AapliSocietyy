// app/api/auth/logout/route.js
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { revokeRefreshToken, clearRefreshCookie } from "@/lib/refresh-token";
import { verifyToken } from "@/lib/jwt";
import cache from "@/lib/cache";
export async function POST(request) {
  const refreshCookie = request.cookies.get("refreshToken")?.value;
  if (refreshCookie) {
    try {
      await connectDB();
      await revokeRefreshToken(refreshCookie);
    } catch (err) {
      // Best-effort: a DB hiccup here must not block the user from logging
      // out client-side — the access token cookie is cleared below
      // regardless, and an unrevoked refresh token still expires on its own.
      console.error("Refresh token revocation failed during logout:", err);
    }
  }
  // Denylist the access token's jti until its natural expiry, same as
  // app/api/v1/auth/logout — middleware.js checks this key on every /api/*
  // and protected-page request so a "logged out" token stops working
  // immediately instead of staying valid for up to 7 days.
  const accessToken = request.cookies.get("token")?.value;
  const decoded = accessToken && verifyToken(accessToken);
  if (decoded?.jti) {
    const ttlSeconds = Math.max(1, (decoded.exp || 0) - Math.floor(Date.now() / 1000));
    await cache.set(`revoked:jti:${decoded.jti}`, 1, ttlSeconds);
  }
  const res = NextResponse.json({ success: true });
  res.cookies.set("token", "", {
    maxAge: 0,
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
  res.cookies.set("admin_token", "", {
    maxAge: 0,
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
  clearRefreshCookie(res);
  return res;
}

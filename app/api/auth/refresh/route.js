import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { signToken } from "@/lib/jwt";
import { rotateRefreshToken, setRefreshCookie, clearRefreshCookie } from "@/lib/refresh-token";
import { loginBlockFor } from "@/lib/auth/login-block";
// Real rotating refresh: reads the httpOnly refreshToken cookie (never a
// client-supplied token in the body — the previous version accepted any
// signature-valid token from anyone, not necessarily the session's own),
// validates it against the stored/revocable RefreshToken record, rotates
// it, and re-derives claims from the user's *current* profile state (so a
// role/profile change since last login takes effect on refresh, not only on
// next full login).
export async function POST(request) {
  try {
    await connectDB();
    const refreshCookie = request.cookies.get("refreshToken")?.value;
    if (!refreshCookie) {
      return NextResponse.json({ error: "No refresh token" }, { status: 401 });
    }
    const rotated = await rotateRefreshToken(refreshCookie);
    if (!rotated) {
      const res = NextResponse.json({ error: "Invalid or expired refresh token" }, { status: 401 });
      clearRefreshCookie(res);
      return res;
    }
    const user = await User.findById(rotated.userId);
    const block = loginBlockFor(user);
    if (block) {
      // Clearing the cookie matters here: without it the browser keeps
      // retrying a refresh that can never succeed.
      const res = NextResponse.json({ error: block.message, code: block.code }, { status: 401 });
      clearRefreshCookie(res);
      return res;
    }
    const activeProfile = (user.profiles ?? []).find(
      (p) => String(p.profileId) === String(user.activeProfileId) && p.status === "Active",
    );
    const claims = activeProfile
      ? {
          userId: user._id,
          activeProfileId: activeProfile.profileId,
          memberId: activeProfile.memberId,
          societyId: activeProfile.societyId,
          role: activeProfile.role,
        }
      : {
          userId: user._id,
          email: user.email,
          role: user.role,
          societyId: user.societyId,
          societyCode: user.societyCode,
        };
    const newAccessToken = signToken(claims);
    const response = NextResponse.json({ success: true });
    response.cookies.set("token", newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 8,
    });
    setRefreshCookie(response, rotated.refreshToken);
    return response;
  } catch (error) {
    console.error("Token refresh error:", error);
    return NextResponse.json({ error: "Token refresh failed" }, { status: 500 });
  }
}

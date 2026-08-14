// Pre-auth helper for app/auth/login/page.js: the ONLY thing the client does
// with the response is decide which login endpoint to POST credentials to
// (Security accounts use a separate route). It never needs the raw role, and
// it never needs to know whether the identifier exists at all — the original
// version returned both (role string on 200, "User not found" on 404), which
// is a free, unauthenticated, unrate-limited username/email enumeration +
// role-disclosure oracle. isSecurity collapses "not found" and "found but
// not Security" into the same false response, and enforceRateLimit matches
// the same login-adjacent hardening every other auth entry point already has.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { enforceRateLimit } from "@/lib/v1/ratelimit";
import { ApiError } from "@/lib/v1/http";
export async function POST(request) {
  try {
    await connectDB();
    const body = await request.json();
    const username = String(body.username || "")
      .trim()
      .toLowerCase();
    if (!username) {
      return NextResponse.json(
        { error: "Username is required" },
        { status: 400 },
      );
    }
    try {
      await enforceRateLimit(request, "resolve-role", {
        windowMs: 15 * 60 * 1000,
        limit: 10,
        key: username,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json(err.body, { status: err.status });
      }
      throw err;
    }
    const user = await User.findOne({
      $or: [{ username }, { email: username }],
      isActive: true,
    })
      .select("role")
      .lean();
    return NextResponse.json({
      success: true,
      isSecurity: user?.role === "Security",
    });
  } catch (err) {
    console.error("Resolve role error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

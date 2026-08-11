// app/api/auth/login/route.js
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import AuditLog from "@/models/AuditLog";
import { signToken } from "@/lib/jwt";
import { issueRefreshToken, setRefreshCookie } from "@/lib/refresh-token";
import { getStaffProfiles } from "@/lib/rbac/staff-profiles";
const MAX_ATTEMPTS = parseInt(process.env.RATE_LIMIT_LOGIN, 10) || 10;
const WINDOW_MS = 15 * 60 * 1000;
const loginAttempts = new Map();
function checkLoginRateLimit(identifier) {
  const key = identifier.toLowerCase();
  const now = Date.now();
  const entry = loginAttempts.get(key) || {
    count: 0,
    resetAt: now + WINDOW_MS,
  };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + WINDOW_MS;
  }
  entry.count += 1;
  loginAttempts.set(key, entry);
  return entry.count > MAX_ATTEMPTS ? { blocked: true } : { blocked: false };
}
function clearLoginRateLimit(identifier) {
  loginAttempts.delete(identifier.toLowerCase());
}
export async function POST(request) {
  try {
    await connectDB();
    const body = await request.json();
    const rawIdentifier = body.username || body.email || "";
    const rawPassword = body.password;
    if (typeof rawIdentifier !== "string" || typeof rawPassword !== "string") {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 400 },
      );
    }
    const identifier = rawIdentifier.trim().toLowerCase();
    const password = rawPassword;
    if (!identifier || !password) {
      return NextResponse.json(
        { error: "Username/email and password are required" },
        { status: 400 },
      );
    }
    const rateCheck = checkLoginRateLimit(identifier);
    if (rateCheck.blocked) {
      return NextResponse.json(
        { error: "Too many login attempts. Try again later." },
        { status: 429 },
      );
    }
    // Find by username  OR  email  (covers both Member and Admin flows)
    const user = await User.findOne({
      $or: [{ username: identifier }, { email: identifier }],
      isActive: true,
    });
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    const ua = request.headers.get("user-agent") || "unknown";
    if (!user) {
      await AuditLog.create({
        action: "LOGIN_FAILURE",
        newData: { identifier, reason: "user_not_found", ip, ua },
        timestamp: new Date(),
      }).catch(() => {});
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      await AuditLog.create({
        userId: user._id,
        societyId: user.societyId,
        action: "LOGIN_FAILURE",
        newData: { identifier, reason: "wrong_password", ip, ua },
        timestamp: new Date(),
      }).catch(() => {});
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }
    // ── ADMIN / SECRETARY / ACCOUNTANT ───────────────────────────────────────
    // These still carry root-level role + societyId — unchanged flow.
    if (
      [
        "Admin",
        "Secretary",
        "Accountant",
        "Security",
        "SOCIETY_ADMIN",
      ].includes(user.role)
    ) {
      clearLoginRateLimit(identifier);
      const token = signToken({
        userId: user._id,
        email: user.email,
        role: user.role,
        societyId: user.societyId,
        societyCode: user.societyCode,
      });
      const response = NextResponse.json({
        success: true,
        message: "Login successful",
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          societyId: user.societyId,
        },
      });
      response.cookies.set("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 60 * 60 * 8, // 8 hours
      });
      setRefreshCookie(response, await issueRefreshToken(user._id));
      return response;
    }
    // ── MEMBER — multi-profile logic ─────────────────────────────────────────
    const activeProfiles = (user.profiles ?? []).filter(
      (p) => p.status === "Active",
    );
    // A member can ALSO hold a staff RoleAssignment (e.g. "Auditor" on top of
    // their own flat) — those need to appear as selectable entries too, or
    // granting the role gives them no way to ever use it.
    const staffProfiles = await getStaffProfiles(user._id);
    const totalProfileCount = activeProfiles.length + staffProfiles.length;
    // CASE A: exactly one profile total (member OR staff, never both) → auto-login
    if (totalProfileCount === 1 && staffProfiles.length === 1) {
      clearLoginRateLimit(identifier);
      const assignment = staffProfiles[0];
      const token = signToken({
        userId: user._id,
        activeContext: { societyId: assignment.societyId, hat: "staff" },
        // Root-level societyId, additive: authorize()/page-guard.js read
        // activeContext.societyId (checked first, takes priority) — this is
        // only for the large amount of pre-RBAC route code that reads
        // decoded.societyId directly and would otherwise silently scope
        // queries to "undefined" for any RBAC-only staff role.
        societyId: assignment.societyId,
        sessionEpoch: user.sessionEpoch || 0,
      });
      const response = NextResponse.json({
        success: true,
        requiresProfileSelect: false,
        user: {
          id: user._id,
          name: user.name,
          username: user.username,
          role: assignment.role,
          kind: "Staff",
          societyId: assignment.societyId,
          societyName: assignment.societyName,
        },
      });
      response.cookies.set("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 60 * 60 * 8,
      });
      setRefreshCookie(response, await issueRefreshToken(user._id));
      return response;
    }
    if (activeProfiles.length === 1 && staffProfiles.length === 0) {
      clearLoginRateLimit(identifier);
      const profile = activeProfiles[0];
      // Persist activeProfileId
      await User.updateOne(
        { _id: user._id },
        { activeProfileId: profile.profileId },
      );
      const token = signToken({
        userId: user._id,
        activeProfileId: profile.profileId,
        memberId: profile.memberId,
        societyId: profile.societyId,
        role: profile.role,
        occupancyType: profile.occupancyType,
      });
      const response = NextResponse.json({
        success: true,
        requiresProfileSelect: false,
        user: {
          id: user._id,
          name: user.name,
          username: user.username,
          role: profile.role,
          societyId: profile.societyId,
          memberId: profile.memberId,
          flatNo: profile.flatNo,
          wing: profile.wing,
          societyName: profile.societyName,
          activeProfile: profile,
        },
      });
      response.cookies.set("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 60 * 60 * 8,
      });
      setRefreshCookie(response, await issueRefreshToken(user._id));
      return response;
    }
    // CASE B: multiple profiles (member flats and/or staff roles) → return
    // the merged list, frontend shows one selector for all of them.
    if (totalProfileCount > 1) {
      clearLoginRateLimit(identifier);
      const profileSelectToken = signToken(
        {
          userId: user._id,
          purpose: "profile-select",
        },
        { expiresIn: "10m" },
      );
      // Commercial profiles have no flatNo/wing of their own (they link a
      // Shop, not a Member) — resolve the shop label instead of showing a
      // blank "Flat -".
      const commercialShopIds = activeProfiles
        .filter((p) => p.kind === "Commercial" && p.shopId)
        .map((p) => p.shopId);
      let shopLabelById = new Map();
      if (commercialShopIds.length) {
        const Shop = (await import("@/models/Shop")).default;
        const shops = await Shop.find({ _id: { $in: commercialShopIds } })
          .select("wing shopNo")
          .lean();
        shopLabelById = new Map(
          shops.map((s) => [String(s._id), [s.wing, s.shopNo].filter(Boolean).join("-")]),
        );
      }
      // No cookie yet — user must pick a society first
      return NextResponse.json({
        success: true,
        requiresProfileSelect: true,
        userId: user._id,
        profileSelectToken,
        name: user.name,
        username: user.username,
        profiles: [
          ...activeProfiles.map((p) => ({
            profileId: p.profileId,
            societyId: p.societyId,
            societyName: p.societyName,
            flatNo:
              p.kind === "Commercial"
                ? shopLabelById.get(String(p.shopId)) || ""
                : p.flatNo,
            wing: p.kind === "Commercial" ? "" : p.wing,
            role: p.role,
            kind: p.kind || "Residential",
          })),
          ...staffProfiles,
        ],
      });
    }
    // CASE C: Member with zero active profiles (edge case / misconfigured)
    return NextResponse.json(
      { error: "No active society profiles found for this account" },
      { status: 403 },
    );
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

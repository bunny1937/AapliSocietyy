// app/api/auth/me/route.js
import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { getAdminModels } from "@/lib/admin-models";
import { getTokenFromRequest } from "@/lib/jwt";
export async function GET(req) {
  try {
    const adminToken = req.cookies.get("admin_token")?.value;
    const cookieToken = req.cookies.get("token")?.value;
    const authHeader = req.headers.get("authorization");
    const bearerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.substring(7)
      : null;
    const userToken = cookieToken || bearerToken;
    // ── SUPERADMIN ────────────────────────────────────────────────────────────
    if (adminToken) {
      let decoded;
      try {
        decoded = jwt.verify(adminToken, process.env.ADMIN_JWT_SECRET);
      } catch {
        return NextResponse.json(
          { error: "Invalid admin token" },
          { status: 401 },
        );
      }
      if (decoded.role !== "SuperAdmin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const { SuperAdmin } = await getAdminModels();
      const admin = await SuperAdmin.findById(decoded.userId).select(
        "name email role",
      );
      if (!admin) {
        return NextResponse.json({ error: "Admin not found" }, { status: 404 });
      }
      return NextResponse.json({ user: admin });
    }
    // ── ADMIN / SECRETARY / MEMBER ────────────────────────────────────────────
    else if (userToken) {
      let decoded;
      try {
        decoded = jwt.verify(userToken, process.env.JWT_SECRET);
      } catch {
        return NextResponse.json({ error: "Invalid token" }, { status: 401 });
      }
      await connectDB();
      // ── Admin / Secretary — root-level role, unchanged ────────────────────
      if (
        decoded.role === "Admin" ||
        decoded.role === "Secretary" ||
        decoded.role === "Accountant" ||
        decoded.role === "Security" ||
        decoded.role === "SOCIETY_ADMIN"
      ) {
        const user = await User.findById(decoded.userId).select(
          "name email role societyId societyCode",
        );
        if (!user) {
          return NextResponse.json(
            { error: "User not found" },
            { status: 404 },
          );
        }
        return NextResponse.json({ user });
      }
      // ── RBAC staff-hat — RoleAssignment-backed profile (e.g. a member also
      // granted "Auditor"), new token shape { activeContext:{societyId,hat} } ──
      if (decoded.activeContext?.hat === "staff") {
        const user = await User.findById(decoded.userId).select(
          "name email username role isActive",
        );
        if (!user || !user.isActive) {
          return NextResponse.json({ error: "User not found" }, { status: 404 });
        }
        return NextResponse.json({
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            username: user.username,
            role: "Staff",
            societyId: decoded.activeContext.societyId,
          },
        });
      }
      // ── Member — derive context from activeProfileId ──────────────────────
      // JWT contains only { userId, activeProfileId } — never trust societyId from token
      if (decoded.activeProfileId) {
        const user = await User.findById(decoded.userId).select(
          "name username email phone profiles activeProfileId isActive",
        );
        if (!user || !user.isActive) {
          return NextResponse.json(
            { error: "User not found" },
            { status: 404 },
          );
        }
        const activeProfile = user.profiles.find(
          (p) => String(p.profileId) === String(decoded.activeProfileId),
        );
        if (!activeProfile) {
          return NextResponse.json(
            { error: "Active profile not found — please log in again" },
            { status: 401 },
          );
        }
        return NextResponse.json({
          user: {
            id: user._id,
            name: user.name,
            username: user.username,
            email: user.email,
            phone: user.phone,
            // Derived from profile — NEVER from JWT root
            role: activeProfile.role,
            societyId: activeProfile.societyId,
            memberId: activeProfile.memberId,
            flatNo: activeProfile.flatNo,
            wing: activeProfile.wing,
            societyName: activeProfile.societyName,
            activeProfile,
            // All profiles available so frontend can show switcher
            profiles: user.profiles.filter((p) => p.status === "Active"),
          },
        });
      }
      // ── Legacy Member tokens (pre-migration) ─────────────────────────────
      // If token still has old shape { role: "Member", societyId, memberId }
      if (decoded.role === "Member") {
        const user = await User.findById(decoded.userId).select(
          "name email role societyId profiles activeProfileId",
        );
        if (!user) {
          return NextResponse.json(
            { error: "User not found" },
            { status: 404 },
          );
        }
        // If already migrated, use first active profile
        if (user.profiles?.length > 0) {
          const profile =
            user.profiles.find((p) => p.status === "Active") ??
            user.profiles[0];
          return NextResponse.json({
            user: {
              id: user._id,
              name: user.name,
              email: user.email,
              role: profile.role,
              societyId: profile.societyId,
              memberId: profile.memberId,
              flatNo: profile.flatNo,
              wing: profile.wing,
              activeProfile: profile,
            },
          });
        }
        // Not yet migrated — return old shape so nothing breaks
        return NextResponse.json({ user });
      }
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  } catch (err) {
    console.error("/api/auth/me error:", err.message);
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }
}

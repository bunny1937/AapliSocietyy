// GET /api/auth/my-profiles
//
// The in-session half of the web profile switcher.
//
// The login screen already returns every profile on an account (member
// flats/shops merged with RBAC staff hats — see app/api/auth/login/route.js
// CASE B) and /api/auth/switch-profile can already re-issue a session for any
// of them. What was missing on web is a way to ask "what can I switch to?"
// AFTER login, once that one-time response is long gone — mobile has had this
// at /api/v1/auth/my-profiles since the flat-switcher avatar shipped; this is
// its web/cookie-auth equivalent, reusing the exact same picker projection so
// the two surfaces can never show different lists for the same account.

import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import Shop from "@/models/Shop";
import { getTokenFromRequest } from "@/lib/jwt";
import { loginBlockFor } from "@/lib/auth/login-block";
import { getStaffProfiles } from "@/lib/rbac/staff-profiles";
import { attachProfileRoles } from "@/lib/v1/profileRoles";

export async function GET(request) {
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
    }

    const user = await User.findById(decoded.userId).lean();
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const block = loginBlockFor(user);
    if (block) {
      return NextResponse.json({ error: block.message, code: block.code }, { status: 403 });
    }

    const activeProfiles = (user.profiles || []).filter((p) => p.status === "Active");
    const staffProfiles = await getStaffProfiles(user._id);

    const commercialShopIds = activeProfiles
      .filter((p) => p.kind === "Commercial" && p.shopId)
      .map((p) => p.shopId);
    const shopById = new Map(
      commercialShopIds.length
        ? (
            await Shop.find({ _id: { $in: commercialShopIds } })
              .select("shopNo wing unitKind tradeName")
              .lean()
          ).map((s) => [String(s._id), s])
        : [],
    );

    // Same picker shape the login response and the mobile my-profiles route
    // both use, so ONE component can render all three without a translation
    // layer that could drift.
    const memberPickerProfiles = activeProfiles.map((p) => {
      const shop = p.kind === "Commercial" ? shopById.get(String(p.shopId)) : null;
      const unit =
        p.kind === "Commercial"
          ? [shop?.wing, shop?.shopNo].filter(Boolean).join("-") || "Shop"
          : [p.wing, p.flatNo].filter(Boolean).join("-") || "Flat";
      return {
        profileId: String(p.profileId),
        kind: p.kind || "Residential",
        societyName: p.societyName ?? null,
        flatNo: p.kind === "Commercial" ? shop?.shopNo ?? null : p.flatNo ?? null,
        wing: p.kind === "Commercial" ? shop?.wing ?? null : p.wing ?? null,
        occupancyType: p.occupancyType ?? null,
        unitKind: shop?.unitKind ?? null,
        tradeName: shop?.tradeName ?? null,
        isPrimary: p.isPrimary === true,
        status: p.status ?? null,
        role: p.role ?? null,
        label: [unit, shop?.tradeName].filter(Boolean).join(" · "),
      };
    });

    const profiles = await attachProfileRoles(memberPickerProfiles, activeProfiles, String(user._id));

    // A staff hat is not a Member profile, so attachProfileRoles cannot badge
    // it (it has no societyId-keyed source row) — but it already carries its
    // own role/society, so it needs no extra roles of its own to render.
    const allProfiles = [...profiles, ...staffProfiles];

    // Which profile the CURRENT token is scoped to, so the switcher can mark
    // it active without a second round trip.
    const activeProfileId = decoded.activeProfileId
      ? String(decoded.activeProfileId)
      : decoded.activeContext?.hat === "staff"
        ? staffProfiles.find((s) => s.societyId === String(decoded.activeContext.societyId))?.profileId ?? null
        : decoded.role
          ? "legacy-root-role" // Admin/Secretary/Accountant on the old single-society branch
          : null;

    return NextResponse.json({
      name: user.name ?? user.username ?? null,
      username: user.username ?? null,
      activeProfileId,
      canSwitch: allProfiles.length > 1,
      profiles: allProfiles,
    });
  } catch (error) {
    console.error("auth/my-profiles error:", error);
    return NextResponse.json(
      { error: error?.message || "Your profiles could not be loaded." },
      { status: 500 },
    );
  }
}

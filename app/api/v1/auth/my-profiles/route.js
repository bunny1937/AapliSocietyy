// app/api/v1/auth/my-profiles/route.js
//
// NEW. Lists every active flat on the signed-in account, plus which one is
// currently active.
//
// Needed because the flat switcher now lives on the dashboard avatar, not only
// on the login screen. At login the profile list arrives inside the login
// response; once you are inside the app that response is long gone, so the
// switcher needs its own read.
//
// Requires a NORMAL access token (pending tokens are rejected by getClaims) -
// you must already be inside a session to enumerate the account's flats.

import { withRoute, ApiError, json } from "@/lib/v1/http";
import { loginBlockFor } from "@/lib/auth/login-block";
import { getClaims } from "@/lib/v1/auth";
import { User } from "@/lib/v1/models";
import Shop from "@/models/Shop";
import { attachProfileRoles } from "@/lib/v1/profileRoles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Same shape /auth/login sends for the picker, so ProfileSummary.fromJson on
// the app parses both without needing a second model.
function toPickerProfile(p, shopById) {
  if (p.kind === "Commercial") {
    const shop = shopById.get(String(p.shopId));
    const unit = [shop?.wing, shop?.shopNo].filter(Boolean).join("-") || "Shop";
    return {
      profileId: String(p.profileId ?? p._id),
      kind: "Commercial",
      societyName: p.societyName ?? null,
      shopNo: shop?.shopNo ?? null,
      wing: shop?.wing ?? null,
      unitKind: shop?.unitKind ?? null,
      tradeName: shop?.tradeName ?? null,
      isPrimary: p.isPrimary === true,
      status: p.status ?? null,
      label: [unit, shop?.tradeName].filter(Boolean).join(" \u00b7 "),
    };
  }
  const wing = p.wing ?? null;
  const flatNo = p.flatNo ?? null;
  const unit = [wing, flatNo].filter(Boolean).join("-") || "Flat";
  return {
    profileId: String(p.profileId ?? p._id),
    kind: "Residential",
    societyName: p.societyName ?? null,
    flatNo,
    wing,
    occupancyType: p.occupancyType ?? null,
    isPrimary: p.isPrimary === true,
    status: p.status ?? null,
    label: [unit, p.societyName].filter(Boolean).join(" \u00b7 "),
  };
}

export const GET = withRoute(async (req) => {
  const claims = getClaims(req);

  const user = await User.findById(claims.userId).lean();
  if (!user) throw new ApiError(401, "User not found");
  const block = loginBlockFor(user);
  if (block) throw new ApiError(403, { error: block.message, code: block.code });

  const activeProfiles = (user.profiles || []).filter((p) => p.status === "Active");
  const shopIds = activeProfiles.filter((p) => p.kind === "Commercial").map((p) => p.shopId);
  const shopById = new Map(
    shopIds.length
      ? (await Shop.find({ _id: { $in: shopIds } }).select("shopNo wing unitKind tradeName").lean())
          .map((s) => [String(s._id), s])
      : [],
  );
  const profiles = await attachProfileRoles(
    activeProfiles.map((p) => toPickerProfile(p, shopById)),
    activeProfiles,
    String(user._id),
  );

  return json({
    name: user.name ?? user.username ?? null,
    username: user.username ?? null,
    // Prefer the claim: it is what the current token is actually scoped to.
    // user.activeProfileId can lag if two devices switched concurrently.
    activeProfileId: String(claims.activeProfileId ?? user.activeProfileId ?? ""),
    canSwitch: profiles.length > 1,
    profiles,
  });
});

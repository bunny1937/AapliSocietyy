// app/api/v1/auth/login/route.js
//
// THIS is the login route the Flutter app actually talks to.
//
// The app's Dio baseUrl is https://aaplisociety.visync.in/v1, and vercel.json
// rewrites /v1/:path* -> /api/v1/:path*. So `dio.post('/auth/login')` lands
// here. It does NOT land on app/api/auth/login/route.js - that one is the
// website's cookie-session route and the app never calls it.
//
// That distinction is what round 4 got wrong. The field names were corrected
// to match the website route while the app was pointed at this one.
//
// FIX APPLIED HERE: the response now carries BOTH sets of field names.
//
//   needsProfileSelect  +  requiresProfileSelect   (same boolean)
//   selectToken         +  profileSelectToken      (same string)
//
// Purely additive, so nothing that reads the old names breaks. Any client
// still on the old contract keeps working; the patched app reads the new ones.
// Once every build in the wild reads the new names, delete the two legacy
// keys and the aliasing block below.
//
// Also added, because the flat picker needs them and was rendering
// "Society / Owner" placeholders for every flat:
//   - name           (the picker greets the member by name)
//   - wing, occupancyType, isPrimary, status on each profile

import bcrypt from "bcryptjs";
import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { loginBlockFor } from "@/lib/auth/login-block";
import { loginSchema } from "@/lib/v1/schemas";
import { User } from "@/lib/v1/models";
import { issueTokens } from "@/lib/v1/authService";
import { signAccess } from "@/lib/v1/jwt";
import { enforceRateLimit } from "@/lib/v1/ratelimit";
import { OCCUPANCY_TYPES } from "@/lib/v1/constants";
import Shop from "@/models/Shop";
import { attachProfileRoles } from "@/lib/v1/profileRoles";
import { verifyTurnstileToken } from "@/lib/turnstile";

// Shapes one profile for the picker. The old response sent only
// profileId/societyName/flatNo, so every flat rendered the same
// "Society · Owner" placeholder and users could not tell 101 from 201.
// A Commercial profile renders a shop card instead — its own identity
// (shopNo, unitKind, tradeName) lives on Shop, never duplicated here.
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
      label: [unit, shop?.tradeName].filter(Boolean).join(" · "),
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
    label: [unit, p.societyName].filter(Boolean).join(" · "),
  };
}
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function verifyPassword(plain, user) {
  const hash = user.password || user.passwordHash;
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}


export const POST = withRoute(async (req) => {
  // enforceRateLimit is async now that the counter lives in shared Redis rather
  // than in this instance's memory. Forgetting the await would silently disable
  // the limit (a pending promise is truthy and never throws here).
  const commit = await enforceRateLimit(req, "login", {
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
  });
  const body = await req.json().catch(() => ({}));
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);
  const identifier = parsed.data.identifier.trim().toLowerCase();
  const { password } = parsed.data;

  const turnstileOk = await verifyTurnstileToken(
    body.turnstileToken,
    req.headers.get("x-forwarded-for") || undefined,
  );
  if (!turnstileOk) {
    throw new ApiError(400, "Verification failed. Please try again.");
  }

  const user = await User.findOne({
    $or: [{ username: identifier }, { email: identifier }],
  });
  if (!user || !(await verifyPassword(password, user))) {
    throw new ApiError(401, "Invalid credentials");
  }
  // Same block rules as the web login, from the one shared helper, so a
  // paused or disabled account cannot get in through the mobile app.
  const block = loginBlockFor(user);
  if (block) throw new ApiError(403, { error: block.message, code: block.code });

  const activeProfiles = (user.profiles || []).filter(
    (p) => p.status === "Active",
  );

  // Staff accounts without member profiles fall back to their root scope.
  if (activeProfiles.length === 0) {
    const result = await issueTokens(user, {
      role: user.role,
      societyId: user.societyId,
      memberId: user.memberId,
      occupancyType: OCCUPANCY_TYPES.OWNER,
    });
    commit(true);
    return json({ ...result, needsProfileSelect: false, requiresProfileSelect: false });
  }

  if (activeProfiles.length === 1) {
    const result = await issueTokens(user, activeProfiles[0]);
    commit(true);
    return json({ ...result, needsProfileSelect: false, requiresProfileSelect: false });
  }

  // Multiple profiles → client must choose one via /auth/switch-profile.
  //
  // This is Bhavani's path: one account, three Active profiles, so she gets a
  // pending token and the picker. If she lands straight on a dashboard
  // instead, the cause is upstream — three separate User docs from the old
  // import bug, each holding one profile — not this branch.
  const selectToken = signAccess({
    userId: String(user._id),
    role: user.role,
    pending: true,
  });
  commit(true);
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
    // Both name pairs on purpose. The app reads requiresProfileSelect/
    // profileSelectToken; older shipped builds read needsProfileSelect/
    // selectToken. Additive, so app and API can deploy in either order.
    // Remove the legacy pair once no shipped build reads it.
    needsProfileSelect: true,
    requiresProfileSelect: true,
    selectToken,
    profileSelectToken: selectToken,
    userId: String(user._id),
    name: user.name ?? user.username ?? null,
    username: user.username ?? null,
    profiles,
  });
});
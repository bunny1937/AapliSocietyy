// app/api/v1/auth/switch-profile/route.js
//
// Two jobs now:
//
//   1. FIRST SELECTION   - caller holds a `pending: true` token from /auth/login
//                          and has no session yet. Token arrives in the body.
//   2. IN-SESSION SWITCH - caller is already fully signed in on flat 101 and
//                          wants to jump to 201 from the dashboard avatar.
//                          Token is a normal access token on the header.
//
// Both end in the same place: verify the profile really belongs to this user,
// persist activeProfileId, mint a fresh token pair scoped to that profile.
// Case 2 used to be rejected with 400 "Profile already selected", which is why
// the only way to change flat was to log out and back in.
//
// NOTE ON THE 404 THIS ROUTE RETURNED ON EVERY SINGLE CALL:
// the bug was never in this file. lib/v1/models.js did not declare `profileId`
// on its profile sub-schema and used { _id: true }, so Mongoose minted a fresh
// random id per hydration and login/switch could never agree. See the comment
// block in lib/v1/models.js.

import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { loginBlockFor } from "@/lib/auth/login-block";
import { getClaims } from "@/lib/v1/auth";
import { verifyAccess } from "@/lib/v1/jwt";
import { profileSelectSchema } from "@/lib/v1/schemas";
import { User } from "@/lib/v1/models";
import { issueTokens } from "@/lib/v1/authService";
import Shop from "@/models/Shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The body token wins when present. It is request-scoped and deliberately not
// persisted by the app, so it is always the caller's real intent. The header is
// whatever the Dio interceptor happened to hold, which during first selection
// is nothing and after a switch is the OLD profile's token.
function claimsFrom(req, bodyToken) {
  if (bodyToken) {
    try {
      return verifyAccess(bodyToken);
    } catch {
      throw new ApiError(401, "Profile selection expired. Please sign in again.");
    }
  }
  try {
    return getClaims(req, { allowPending: true });
  } catch {
    throw new ApiError(
      401,
      "No token. Send the profile-select token from login as an Authorization header or as profileSelectToken in the body.",
    );
  }
}

export const POST = withRoute(async (req) => {
  const body = await req.json().catch(() => ({}));

  const bodyToken = body.profileSelectToken || body.selectToken || null;
  const claims = claimsFrom(req, bodyToken);

  // Accepted deliberately whether or not claims.pending is set:
  //   pending  -> first selection straight after login
  //   !pending -> in-session switch from the dashboard avatar
  // A non-pending token is strictly MORE authenticated than a pending one, so
  // allowing it does not widen access. The profile-belongs-to-user check below
  // is the real gate in both cases.
  const parsed = profileSelectSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);

  const user = await User.findById(claims.userId);
  if (!user) throw new ApiError(401, "User not found");
  const block = loginBlockFor(user);
  if (block) throw new ApiError(403, { error: block.message, code: block.code });

  const profile = (user.profiles || []).find(
    (p) =>
      String(p.profileId ?? p._id) === parsed.data.profileId &&
      p.status === "Active",
  );

  if (!profile) {
    // Never leak the id list in production, but make a repeat of this class of
    // bug diagnosable in one request instead of one evening.
    const available = (user.profiles || [])
      .filter((p) => p.status === "Active")
      .map((p) => `${p.wing || ""}-${p.flatNo || "?"}:${String(p.profileId ?? p._id)}`);
    throw new ApiError(
      404,
      process.env.NODE_ENV === "production"
        ? "Profile not found"
        : `Profile not found. Sent ${parsed.data.profileId}; user ${user._id} has [${available.join(", ")}]`,
    );
  }

  // Persist so /v1/auth/me, the website session and the app all agree on which
  // flat is active. Without this the app and web disagree after a switch.
  const chosenId = String(profile.profileId ?? profile._id);
  if (String(user.activeProfileId ?? "") !== chosenId) {
    user.activeProfileId = profile.profileId ?? profile._id;
    await user.save();
  }

  const result = await issueTokens(user, profile);

  // Echo the chosen unit so the app can repaint the avatar without a round
  // trip to /auth/me. Purely additive.
  let activeProfile;
  if (profile.kind === "Commercial") {
    const shop = await Shop.findOne({ _id: profile.shopId }).select("shopNo wing unitKind tradeName").lean();
    activeProfile = {
      profileId: chosenId,
      kind: "Commercial",
      shopNo: shop?.shopNo ?? null,
      wing: shop?.wing ?? null,
      unitKind: shop?.unitKind ?? null,
      tradeName: shop?.tradeName ?? null,
      societyName: profile.societyName ?? null,
    };
  } else {
    activeProfile = {
      profileId: chosenId,
      kind: "Residential",
      flatNo: profile.flatNo ?? null,
      wing: profile.wing ?? null,
      societyName: profile.societyName ?? null,
      occupancyType: profile.occupancyType ?? null,
    };
  }

  return json({ ...result, activeProfile });
});

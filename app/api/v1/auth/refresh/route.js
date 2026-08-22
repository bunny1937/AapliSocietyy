import { withRoute, ApiError, json } from "@/lib/v1/http";
import { loginBlockFor } from "@/lib/auth/login-block";
import { verifyRefresh } from "@/lib/v1/jwt";
import { RefreshToken, User } from "@/lib/v1/models";
import { issueTokens } from "@/lib/v1/authService";
import { OCCUPANCY_TYPES } from "@/lib/v1/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withRoute(async (req) => {
  const body = await req.json().catch(() => ({}));
  const token = body?.refreshToken;
  if (!token) throw new ApiError(400, "refreshToken is required");

  let payload;
  try {
    payload = verifyRefresh(token);
  } catch {
    throw new ApiError(401, "Invalid refresh token");
  }

  // Enforce rotation: the presented jti must exist and be unrevoked.
  const stored = await RefreshToken.findOne({ jti: payload.jti });
  if (!stored || stored.revoked) throw new ApiError(401, "Refresh token revoked");
  // Rotation consumes the token. Delete it immediately instead of retaining
  // hundreds of revoked rows until their natural TTL date.
  await RefreshToken.deleteOne({ _id: stored._id });

  const user = await User.findById(payload.userId);
  const block = loginBlockFor(user);
  if (block) throw new ApiError(401, { error: block.message, code: block.code });

  // Re-scope to the same profile the refresh token was issued for.
  let profile = null;
  if (payload.profileId) {
    profile = (user.profiles || []).find(
      (p) => String(p.profileId ?? p._id) === String(payload.profileId) && p.status === "Active",
    );
  }
  if (!profile) {
    const active = (user.profiles || []).filter((p) => p.status === "Active");
    profile =
      active.length === 1
        ? active[0]
        : { role: user.role, societyId: user.societyId, memberId: user.memberId, occupancyType: OCCUPANCY_TYPES.OWNER };
  }

  return json(await issueTokens(user, profile));
});
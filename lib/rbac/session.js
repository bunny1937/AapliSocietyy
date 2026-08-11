/**
 * ============================================================================
 * AapliSociety RBAC — Session / privilege-reduction coordinator
 * ============================================================================
 * Frozen decision (Q11): when a user's privileges are REDUCED, security takes
 * priority — the affected session is invalidated and the user must re-auth.
 * Additive GRANTS must NOT force logout.
 *
 * Mechanism:
 *   - User.sessionEpoch is a monotonic counter embedded into every access JWT.
 *   - middleware / authorize() reject any token whose epoch < the user's
 *     current epoch (401 -> forced re-auth).
 *   - bumpSessionEpoch() also revokes the user's refresh tokens so the silent
 *     refresh path cannot mint a new access token from an old session.
 *
 * Cache correctness: every reduction OR grant bumps Society.rbacVersion, which
 * rotates the perms cache key so stale permissions are never served.
 *
 * NOTE (documented limitation, per architecture challenge #3): sessionEpoch is
 * a single per-user scalar in the frozen Rev 2 design, so a reduction in one
 * society forces re-auth on ALL of that user's devices/societies. This is safe
 * (never under-secures) but broader than strictly necessary. Upgrading to a
 * per-context epoch map is a compatible future change and is called out in the
 * handover "Known Limitations".
 * ============================================================================
 */

import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import Society from "@/models/Society";
import RefreshToken from "@/models/RefreshToken";

/** Increment the user's session epoch => all existing access tokens invalid. */
export async function bumpSessionEpoch(userId) {
  await connectDB();
  const updated = await User.findByIdAndUpdate(
    userId,
    { $inc: { sessionEpoch: 1 } },
    { new: true, select: "sessionEpoch" },
  );
  await revokeUserRefreshTokens(userId);
  return updated?.sessionEpoch ?? null;
}

/** Bump the society-wide RBAC version => perms cache keys rotate immediately. */
export async function bumpRbacVersion(societyId) {
  await connectDB();
  await Society.updateOne({ societyId }, { $inc: { rbacVersion: 1 } });
}

/**
 * Call after ANY RBAC mutation.
 * @param {{ societyId:string, affectedUserIds?:string[], reduced?:boolean }} opts
 *  - reduced=true  -> privilege reduction: force re-auth for affected users
 *  - reduced=false -> pure grant: refresh caches only, no forced logout
 */
export async function onRbacMutation({
  societyId,
  affectedUserIds = [],
  reduced = false,
}) {
  if (societyId) await bumpRbacVersion(societyId);
  if (reduced) {
    for (const uid of affectedUserIds) {
      await bumpSessionEpoch(uid);
    }
  }
}

async function revokeUserRefreshTokens(userId) {
  try {
    // Mark all of the user's refresh tokens revoked so the silent-refresh path
    // cannot mint a fresh access token from an old session. If lib/refresh-token
    // later exposes a bulk revoke helper, prefer wiring that in here.
    await RefreshToken.updateMany(
      { userId, revoked: { $ne: true } },
      { $set: { revoked: true, revokedAt: new Date() } },
    );
  } catch (err) {
    console.error("[rbac] revokeUserRefreshTokens failed:", err?.message);
  }
}

export default { bumpSessionEpoch, bumpRbacVersion, onRbacMutation };

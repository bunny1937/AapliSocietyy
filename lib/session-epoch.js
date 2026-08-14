// lib/session-epoch.js
//
// Edge-safe cache of User.sessionEpoch, so middleware.js (Edge runtime, no
// Mongo access) can enforce the same session-freshness rule that
// lib/rbac/authorize.js already enforces via a live DB read for RBAC routes.
//
// Only lib/cache (Upstash REST, plain fetch) is imported here — nothing
// Node-only — so this file is safe to import from middleware.
import cache from "@/lib/cache";

// Must outlive the longest-lived access token (web tokens default to 7d —
// lib/jwt.js) so a bump can't fall out of cache while an old token it should
// still be blocking is still technically unexpired.
export const SESSION_EPOCH_TTL_SECONDS = 60 * 60 * 24 * 8;
const PREFIX = "session-epoch-floor:";

function key(userId) {
  return `${PREFIX}${userId}`;
}

/** Called by lib/rbac/session.js.bumpSessionEpoch after it persists the new epoch. */
export async function setSessionEpochFloor(userId, epoch) {
  if (!userId || epoch === null || epoch === undefined) return;
  await cache.set(key(userId), epoch, SESSION_EPOCH_TTL_SECONDS);
}

/**
 * Returns the last-known-bumped epoch for a user, or null if no bump has
 * ever been cached for them (i.e. nothing to enforce — fail-open is correct
 * here: an unbumped user's token is exactly as fresh as it was at issuance).
 */
export async function getSessionEpochFloor(userId) {
  if (!userId) return null;
  const value = await cache.get(key(userId));
  return typeof value === "number" ? value : null;
}

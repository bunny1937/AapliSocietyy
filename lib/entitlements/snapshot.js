import cache from "@/lib/cache";

// The edge-readable copy of a society's entitlements.
//
// ## Why a second representation exists
//
// lib/entitlements/resolve.js is the authority, but it reads Mongo, and
// middleware.js runs on the edge runtime where Mongo is unreachable. That is
// the same split RBAC already lives with: coarse checks in middleware, DB-backed
// checks in the route/page guard.
//
// Gating 173 module routes one handler at a time would have worked and would
// have leaked. Every new route under /api/v1/amenities would need somebody to
// remember, and the failure is silent — a paid feature served to a society that
// never bought it, with nothing thrown and nothing logged. Gating by *path* in
// middleware covers every route that exists and every route not written yet,
// which is the only version of this that stays true.
//
// So the snapshot is a small, self-contained blob the edge can read in one
// call:
//
//     society-modules:<societyId> → { modules, state, canRead, canWrite, name }
//
// No version in the key, unlike the resolver's cache: middleware cannot look a
// version up, so invalidation here is an overwrite or a delete.
//
// ## What happens when it is missing
//
// Middleware lets the request through.
//
// That is a deliberate choice between two bad options. Failing closed means a
// paying society loses its features the moment Redis evicts a key — an outage
// caused by our own cache, hitting customers who did nothing wrong. Failing
// open means a brief window where an unentitled society could reach a module
// route.
//
// The window is small and self-healing: any request that reaches
// loadEntitlements rewrites the snapshot, and the admin sidebar calls
// /api/rbac/my-access on every page load, so a cold key is repopulated within
// one navigation. It is also not attacker-triggerable — nobody outside can
// evict our Redis. Given a hole nobody can open on demand versus an outage we
// inflict on paying customers, the hole is the better failure.
//
// The per-route `requireModule` guard is the backstop for the same reason:
// where a route is worth a Mongo read of its own, it does not depend on the
// snapshot at all.

const KEY_PREFIX = "society-modules:";
// Matches the access-token lifetime. A snapshot written at login should stay
// valid for as long as that login does.
const TTL_SECONDS = 7 * 24 * 60 * 60;

export const snapshotKey = (societyId) => `${KEY_PREFIX}${societyId}`;

/**
 * @param entitlements the shape returned by resolveEntitlements/loadEntitlements
 */
export async function writeEntitlementSnapshot(societyId, { modules, lifecycle, societyName }) {
  if (!societyId || !modules) return;
  await cache.set(
    snapshotKey(societyId),
    {
      modules,
      state: lifecycle?.state ?? null,
      canRead: lifecycle?.canRead ?? true,
      canWrite: lifecycle?.canWrite ?? true,
      name: societyName ?? null,
      at: Date.now(),
    },
    TTL_SECONDS,
  );
}

/** Edge-safe read. Returns null when cold — see the note above on why. */
export async function readEntitlementSnapshot(societyId) {
  if (!societyId) return null;
  try {
    return (await cache.get(snapshotKey(societyId))) || null;
  } catch {
    // A Redis failure must never take the site down. Same judgement as the
    // missing-key case, for the same reason.
    return null;
  }
}

export async function clearEntitlementSnapshot(societyId) {
  if (!societyId) return;
  await cache.del(snapshotKey(societyId));
}

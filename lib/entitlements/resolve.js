import Society from "@/models/Society";
import cache from "@/lib/cache";
import { MODULES, MODULE_KEYS } from "./modules";
import { societyLifecycle } from "./lifecycle";
import { writeEntitlementSnapshot, clearEntitlementSnapshot } from "./snapshot";

// What a society is actually entitled to, right now.
//
// ## Why Redis and not a JWT claim
//
// A token claim cannot be recalled. Tokens here live up to 7 days, so a
// society suspended on Monday would keep everything until the following
// Monday — which is exactly the bug `revoked:jti:<jti>` was added to fix for
// logout and `getSessionEpochFloor` for privilege reduction. Both solved it
// the same way: the token carries the claim, Redis carries the invalidation.
// A third instance of the same problem should not get a third, worse answer.
//
// A client-sent cookie or header is not a control at all — an unsigned boolean
// the client supplies is a suggestion, one devtools edit away.
//
// The cost of doing it properly is one Redis read on a path that already
// performs three (revocation denylist, session-epoch floor, paused-society
// key, all in middleware.js). What it buys is instant revocation: bump
// entitlementVersion and every node sees the change on its next request, the
// same mechanism rbacVersion already uses.
//
// The JWT and /v1/me still carry the entitlement set — as a *hint*, so the
// sidebar renders correctly on first paint with no flash. The server never
// trusts it. Client copy for speed, server copy for truth.

const CACHE_PREFIX = "entitlements:";
const TTL_SECONDS = 300;

/** Everything off — the answer when a society cannot be identified at all. */
export function emptyEntitlements() {
  return Object.fromEntries(MODULE_KEYS.map((k) => [k, false]));
}

/**
 * Flags as stored, normalised. Mirrors normalizeCommercialFlags: a parent
 * `enabled: false` overrides every child, so one switch kills a module.
 */
export function normalizeFeatures(features) {
  const out = {};
  for (const mod of MODULES) {
    out[mod.key] = features?.[mod.key]?.enabled === true;
  }
  return out;
}

/**
 * The resolver. Three inputs, in precedence order:
 *
 *   1. lifecycle — a trial grants everything; a blocked society grants nothing
 *   2. per-society flags — what was actually sold
 *   3. dependsOn — a module whose dependency is off is itself off
 *
 * Deliberately pure and synchronous so it can be unit-tested without a
 * database and reused by the migration script.
 */
export function resolveEntitlements(society, now = Date.now()) {
  const lifecycle = societyLifecycle(society, now);
  const stored = normalizeFeatures(society?.features);

  // A trial is a trial of the whole product. It also means the downgrade path
  // is exercised on every signup and cannot rot.
  let granted = lifecycle.allModules
    ? Object.fromEntries(MODULE_KEYS.map((k) => [k, true]))
    : { ...stored };

  // Blocked societies keep nothing. Read access for members is handled by the
  // middleware gate, which is a different question from entitlement.
  if (!lifecycle.canRead) granted = emptyEntitlements();

  // Dependencies, applied until stable — a chain A→B→C must collapse fully,
  // and the list is small enough that a fixed point costs nothing.
  for (let pass = 0; pass < MODULES.length; pass++) {
    let changed = false;
    for (const mod of MODULES) {
      if (!granted[mod.key]) continue;
      if (mod.dependsOn.some((dep) => granted[dep] === false)) {
        granted[mod.key] = false;
        changed = true;
      }
    }
    if (!changed) break;
  }

  return { modules: granted, lifecycle };
}

function cacheKey(societyId, version) {
  return `${CACHE_PREFIX}${societyId}:${version || 0}`;
}

/**
 * Cached lookup. The version in the key means invalidation is a write to the
 * society, not a delete across an unknown set of keys — the old entry simply
 * stops being addressed and expires on its own.
 */
export async function loadEntitlements(societyId) {
  if (!societyId) return { modules: emptyEntitlements(), lifecycle: null, societyId: null };

  // The version has to be read before the cache can be addressed, so this is
  // one lean Mongo read of three small fields. Cheap, and it is what makes a
  // revocation take effect immediately rather than in five minutes.
  const head = await Society.findById(societyId)
    .select("entitlementVersion")
    .lean();
  if (!head) return { modules: emptyEntitlements(), lifecycle: null, societyId };

  const key = cacheKey(societyId, head.entitlementVersion);
  const cached = await cache.get(key);
  if (cached) {
    // Lifecycle is time-dependent: a cached "grace" is wrong the moment the
    // clock rolls into "restricted". Modules are cached; the lifecycle is
    // always recomputed from the cached dates.
    const lifecycle = societyLifecycle({ subscription: cached.subscription }, Date.now());
    return { modules: cached.modules, lifecycle, societyId, cached: true };
  }

  const society = await Society.findById(societyId)
    .select("features subscription entitlementVersion name")
    .lean();
  if (!society) return { modules: emptyEntitlements(), lifecycle: null, societyId };

  const resolved = resolveEntitlements(society);
  await cache.set(
    key,
    { modules: resolved.modules, subscription: society.subscription || {} },
    TTL_SECONDS,
  );
  // Repopulate the edge-readable copy on the same pass. This is what makes a
  // cold snapshot self-healing: any request that gets this far fixes it for
  // every subsequent request, including the middleware ones that cannot reach
  // Mongo themselves.
  await writeEntitlementSnapshot(societyId, {
    modules: resolved.modules,
    lifecycle: resolved.lifecycle,
    societyName: society.name,
  });
  return { ...resolved, societyId, societyName: society.name, cached: false };
}

/**
 * Invalidate by bumping the version. Every node sees it on the next request;
 * nothing has to be deleted, and there is no window where one node serves a
 * stale answer while another serves a fresh one.
 */
export async function bumpEntitlementVersion(societyId) {
  if (!societyId) return;
  await Society.updateOne({ _id: societyId }, { $inc: { entitlementVersion: 1 } });
  // The version bump orphans the resolver's cache entry, but the edge snapshot
  // has no version in its key — it must be dropped explicitly or middleware
  // would keep enforcing the old entitlements for up to a week.
  await clearEntitlementSnapshot(societyId);
}

/**
 * Force the edge snapshot to match the database right now. Called at login,
 * where a Mongo read is happening anyway, so a session starts with its
 * entitlements already warm at the edge.
 */
export async function refreshEntitlementSnapshot(societyId) {
  if (!societyId) return null;
  const society = await Society.findById(societyId)
    .select("features subscription name")
    .lean();
  if (!society) return null;
  const resolved = resolveEntitlements(society);
  await writeEntitlementSnapshot(societyId, {
    modules: resolved.modules,
    lifecycle: resolved.lifecycle,
    societyName: society.name,
  });
  return resolved;
}

/** Convenience for a single check. */
export async function hasModule(societyId, moduleKey) {
  const { modules } = await loadEntitlements(societyId);
  return modules[moduleKey] === true;
}

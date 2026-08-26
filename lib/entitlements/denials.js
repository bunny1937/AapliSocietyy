import { setting } from "@/lib/platform/settings";
import cache from "@/lib/cache";

// Recording who knocked on a door they have not bought.
//
// ## The awkward constraint
//
// The gate lives in middleware, which runs on the edge and cannot write to
// Mongo. So denials are aggregated in Redis where the gate can reach them, and
// drained into Mongo by a job that can.
//
// The aggregate is read-modify-write rather than atomic increments, because
// lib/cache exposes get/set/del and nothing else. Concurrent denials can
// therefore lose an update and undercount.
//
// That is fine, and worth being explicit about rather than pretending
// otherwise: this feeds a *threshold* — "did this society knock at least ten
// times" — not an invoice. Undercounting delays an alert by a few requests.
// Adding a distributed counter to make it exact would cost a round trip on
// every denial to improve a number nobody reads directly.
//
// ## Why the aggregate is shaped the way it is
//
// One key per society per hour, holding counts rather than a list of events.
// A list would grow without bound under a script hammering a route, and the
// alert only ever renders totals. The buckets are hour-long so the drain job
// can process whole windows and never race the window currently being written.

const KEY_PREFIX = "entitlement-denials:";
const WINDOW_MS = 60 * 60 * 1000;
// Two windows: long enough for the drain job to pick up a closed bucket even
// if it misses a run, short enough that abandoned buckets clear themselves.
const TTL_SECONDS = 3 * 60 * 60;

export const windowStart = (now = Date.now()) => Math.floor(now / WINDOW_MS) * WINDOW_MS;
export const denialKey = (societyId, window) => `${KEY_PREFIX}${societyId}:${window}`;
// Which societies have a bucket this window. Without it the drain job would
// have to read one Redis key per society on the platform every hour, almost
// all of them empty — an O(societies) sweep to find the usually-zero societies
// that actually knocked.
export const indexKey = (window) => `${KEY_PREFIX}index:${window}`;

/**
 * Fold one denial into its society's current bucket.
 *
 * Never throws. A failure to record must not turn a clean 404 into a 500 — the
 * request was correctly refused either way, and losing an analytics row is not
 * worth an error page.
 */
export async function recordDenial({ societyId, module, userId, userName, role, method, path, ip, surface }) {
  if (!societyId || !module) return;
  try {
    const window = windowStart();
    const key = denialKey(societyId, window);
    const bucket = (await cache.get(key)) || {
      societyId: String(societyId),
      window,
      count: 0,
      first: Date.now(),
      last: Date.now(),
      modules: {},
      users: {},
      paths: {},
      surfaces: {},
    };

    bucket.count += 1;
    bucket.last = Date.now();
    bucket.modules[module] = (bucket.modules[module] || 0) + 1;
    if (path) bucket.paths[path] = (bucket.paths[path] || 0) + 1;
    if (surface) bucket.surfaces[surface] = (bucket.surfaces[surface] || 0) + 1;
    if (userId) {
      const id = String(userId);
      bucket.users[id] = bucket.users[id] || { count: 0, name: userName || null, role: role || null };
      bucket.users[id].count += 1;
    }
    // Kept only for the alert's "first seen / last seen" line, and dropped with
    // the bucket. Deliberately not a per-request log of anyone's activity.
    bucket.lastMethod = method || bucket.lastMethod;
    bucket.lastIp = ip || bucket.lastIp;

    await cache.set(key, bucket, TTL_SECONDS);

    // Cheap membership list. Same read-modify-write tolerance as the bucket:
    // a lost append means one society's denials wait for the following hour,
    // not that they are lost — the bucket itself outlives three windows.
    const id = String(societyId);
    const index = (await cache.get(indexKey(window))) || [];
    if (!index.includes(id)) {
      index.push(id);
      await cache.set(indexKey(window), index, TTL_SECONDS);
    }
  } catch {
    /* see above */
  }
}

export async function readBucket(societyId, window = windowStart()) {
  try {
    return (await cache.get(denialKey(societyId, window))) || null;
  } catch {
    return null;
  }
}

export async function clearBucket(societyId, window) {
  await cache.del(denialKey(societyId, window));
}

/** Societies with anything recorded in a window. */
export async function listDenialSocieties(window = windowStart()) {
  try {
    return (await cache.get(indexKey(window))) || [];
  } catch {
    return [];
  }
}

export async function clearDenialIndex(window) {
  await cache.del(indexKey(window));
}

// ── thresholds ───────────────────────────────────────────────────────────
//
// One 404 is a stale bookmark. Alerting on it would train everybody to ignore
// the alerts, which is the same failure as a coverage script nobody can pass.
//
// The signal is a pattern: sustained knocking, or knocking at several different
// doors — the second being the shape of someone exploring rather than a single
// dead link in a bookmark bar.
// Editable from the superadmin settings page; database -> env -> these.
export const ALERT_MIN_DENIALS = () => setting("ENTITLEMENT_ALERT_MIN_DENIALS");
export const ALERT_MIN_DISTINCT_MODULES = () => setting("ENTITLEMENT_ALERT_MIN_MODULES");

export function bucketCrossesThreshold(bucket) {
  if (!bucket) return false;
  if (bucket.count >= ALERT_MIN_DENIALS()) return true;
  return Object.keys(bucket.modules || {}).length >= ALERT_MIN_DISTINCT_MODULES();
}

/** Ranked, trimmed view for rendering. */
export function summariseBucket(bucket) {
  if (!bucket) return null;
  const rank = (obj, limit) =>
    Object.entries(obj || {})
      .sort((a, b) => (b[1]?.count ?? b[1]) - (a[1]?.count ?? a[1]))
      .slice(0, limit);

  return {
    societyId: bucket.societyId,
    count: bucket.count,
    first: new Date(bucket.first),
    last: new Date(bucket.last),
    modules: rank(bucket.modules, 6).map(([key, count]) => ({ key, count })),
    users: rank(bucket.users, 5).map(([id, u]) => ({
      id,
      name: u.name || "Unknown user",
      role: u.role || null,
      count: u.count,
    })),
    paths: rank(bucket.paths, 6).map(([path, count]) => ({ path, count })),
    surfaces: Object.entries(bucket.surfaces || {}).map(([k, v]) => ({ surface: k, count: v })),
  };
}

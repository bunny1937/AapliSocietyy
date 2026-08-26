import connectDB from "@/lib/mongodb";
import PlatformSetting from "@/models/PlatformSetting";
import { settingDef, settingsFresh, _applyOverrides, _markLoaded } from "./settings";

/**
 * The database half of platform settings. Node runtime only.
 *
 * Kept apart from lib/platform/settings.js because that file is reachable from
 * middleware.js — through lib/entitlements/lifecycle.js and denials.js — and
 * middleware runs on the edge runtime. Anything importable from there ends up
 * in the edge bundle, including through a dynamic import(), which webpack still
 * traces. A mongoose import in that bundle pulls in node:dns and the build
 * fails outright.
 *
 * So: settings.js is pure and edge-safe, this file touches Mongo, and only Node
 * routes import it. The edge reads settings through the env-or-default
 * fallback, which is what it did before any of this existed.
 */

let inflight = null;

/**
 * Load overrides if the cache is stale. Safe to call on every request — a
 * no-op inside the freshness window, and concurrent calls share one query.
 */
export async function ensureSettings(force = false) {
  if (settingsFresh(force)) return;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      await connectDB();
      const rows = await PlatformSetting.find({}).select("key value").lean();
      const next = new Map();
      for (const row of rows) {
        // A row whose key is no longer in the registry is ignored. Removing a
        // setting from the code must not leave a stale value in force.
        if (settingDef(row.key)) next.set(row.key, row.value);
      }
      _applyOverrides(next);
    } catch (err) {
      // Deliberately swallowed. A settings read failing must not take down a
      // purge or a login — the accessors fall through to env and default.
      console.error("[settings] could not load overrides:", err.message);
      _markLoaded();
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

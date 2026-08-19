// TEMP DEV TOOL — DELETE: temporary internal diagnostics tool. Not meant to
// ship long-term; strip this file, its route, and the matching pieces in the
// Flutter app (search "TEMP DEV TOOL") once done using it.
//
// Server-side half of the dev diagnostics page (see the Flutter app's
// Profile > Developer > Diagnostics screen, and lib/core/diagnostics/dev_metrics.dart
// on that side for the client half).
//
// Opt-in only: withRoute (lib/v1/http.js) only calls recordTiming() when the
// request carries `x-dev-diagnostics: 1`. Without that header this file does
// nothing on the request path, so it costs regular traffic zero Redis calls.
// The header is set by the app's diagnostics screen itself when a developer
// is actively looking at it - never by the normal app traffic every member
// generates.
//
// Recording is fire-and-forget (scheduled with next/server's after()) so a
// Redis hiccup here can never slow down or fail the real API response.
import { after } from "next/server";
import redis from "./redis";

const LOG_KEY = "v1:devlog:timings";
const MAX_ENTRIES = 200;

export function wantsTiming(req) {
  return req.headers.get("x-dev-diagnostics") === "1";
}

export function recordTiming({ method, path, durationMs, status }) {
  const entry = JSON.stringify({
    method,
    path,
    durationMs,
    status,
    at: Date.now(),
  });
  const push = (async () => {
    try {
      await redis.command(["LPUSH", LOG_KEY, entry]);
      await redis.command(["LTRIM", LOG_KEY, 0, MAX_ENTRIES - 1]);
    } catch {
      // Best-effort only - never let a logging failure surface anywhere.
    }
  })();
  try {
    after(() => push);
  } catch {
    // Outside a request context (shouldn't happen here, but stay safe).
  }
}

export async function clearTimings() {
  try {
    await redis.command(["DEL", LOG_KEY]);
  } catch {
    // Best-effort.
  }
}

export async function getRecentTimings(limit = 100) {
  try {
    const raw = await redis.command(["LRANGE", LOG_KEY, 0, Math.max(0, limit - 1)]);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

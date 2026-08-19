// TEMP DEV TOOL — DELETE: search "TEMP DEV TOOL" for every piece of this
// (this route, lib/appserverlogs.js, the Flutter diagnostics page + dio
// header tag) once done using it.
//
// Server half of the dev diagnostics screen. Returns the recent request
// timings that lib/v1/http.js's withRoute records whenever a caller sends
// `x-dev-diagnostics: 1` (see lib/appserverlogs.js for why that's opt-in).
//
// Was SuperAdmin-only in production. Loosened to "any logged-in account" -
// single-developer testing right now (no other tenants live), and this whole
// route gets deleted before that stops being true (see TEMP DEV TOOL marker
// above). getClaims() still throws 401 with no/expired token, so this is
// never literally public - just not role-gated anymore.
import { withRoute, json } from "@/lib/v1/http";
import { getClaims } from "@/lib/v1/auth";
import { getRecentTimings, clearTimings } from "@/lib/appserverlogs";

function requireDevAccess(req) {
  getClaims(req);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRoute(async (req) => {
  requireDevAccess(req);
  const timings = await getRecentTimings(150);
  return json({ timings });
});

export const DELETE = withRoute(async (req) => {
  requireDevAccess(req);
  await clearTimings();
  return json({ ok: true });
});

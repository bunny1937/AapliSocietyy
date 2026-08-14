// Server half of the dev diagnostics screen. Returns the recent request
// timings that lib/v1/http.js's withRoute records whenever a caller sends
// `x-dev-diagnostics: 1` (see lib/appserverlogs.js for why that's opt-in).
//
// Locked to SuperAdmin outside development so this never becomes a way to
// read another society's request volume/latency in production.
import { withRoute, json } from "@/lib/v1/http";
import { getClaims, requireRoles } from "@/lib/v1/auth";
import { ROLES } from "@/lib/v1/constants";
import { getRecentTimings, clearTimings } from "@/lib/appserverlogs";

function requireDevAccess(req) {
  if (process.env.NODE_ENV === "production") {
    const claims = getClaims(req);
    requireRoles(claims, [ROLES.SUPER_ADMIN]);
  }
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

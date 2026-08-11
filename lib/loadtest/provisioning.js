// lib/loadtest/provisioning.js
//
// Auto-provisions a brand-new, fully isolated, disposable society + Admin
// account for each load-test lane by calling the REAL public signup route
// (POST /api/auth/signup) -- the same endpoint a genuine new customer would
// hit. This directly replaces the old "log into a second society and paste
// its cookie" flow:
//   - No manual DevTools cookie-copying for ANY lane, including the first.
//   - Every lane's society starts with ZERO members, so "generate bills for
//     every member in the society" (the real, unmodified behavior of
//     /api/billing/generate) can never touch anyone else's data -- safety
//     is now structural, not a checkbox you have to trust yourself on.
//   - N lanes can run truly concurrently, each against its own society,
//     because each lane authenticates with its OWN bearer token instead of
//     sharing this browser tab's cookie.
//
// IMPORTANT: every call here uses credentials:"omit". POST /api/auth/signup
// also sets a `token` cookie as a side effect for normal browser signups --
// if we let that cookie through, it would silently log the CURRENT admin
// (whoever has this tab open) out of their real session and into the new
// throwaway test society. Omitting credentials means we only ever use the
// `token` field returned in the JSON body, and the ambient session/cookie
// in this tab is never touched.
//
// Requires the target deployment to have ALLOW_PUBLIC_SIGNUP=true set (the
// route 403s otherwise when NODE_ENV=production -- see the route's own
// guard). If that flag isn't set, use the "paste an existing token" manual
// mode instead (see manualLane below).

const SIGNUP_URL = "/api/auth/signup";

export function buildLaneIdentity(runTag, laneIndex) {
  const tag = `${runTag}L${laneIndex}`;
  return {
    societyName: `LOADTEST ${runTag} Lane ${laneIndex}`,
    fullName: "Load Test Admin",
    email: `loadtest.${runTag.toLowerCase()}.lane${laneIndex}@example-loadtest.invalid`,
    password: `LoadTest_${tag}_Aa1!`,
    address: "1 Disposable Society Lane, Load Test City",
  };
}

// Provisions one fresh society + Admin for one lane. Returns a normalized
// result the runner can use directly as a `lane.token` source.
export async function provisionSociety({ runTag, laneIndex }) {
  const identity = buildLaneIdentity(runTag, laneIndex);
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  let res;
  let networkError = null;
  try {
    res = await fetch(SIGNUP_URL, {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: identity.fullName,
        email: identity.email,
        password: identity.password,
        societyName: identity.societyName,
        address: identity.address,
      }),
    });
  } catch (err) {
    networkError = err?.message || "Network error while provisioning society";
  }
  const elapsedMs = Math.round(
    (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt,
  );
  if (networkError) {
    return {
      ok: false,
      status: 0,
      elapsedMs,
      error: networkError,
      identity,
    };
  }
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    body = null;
  }
  if (!res.ok || !body?.token) {
    const blockedByFlag =
      res.status === 403 && /public signup is disabled/i.test(body?.error || "");
    return {
      ok: false,
      status: res.status,
      elapsedMs,
      error: body?.error || `Signup failed with HTTP ${res.status}`,
      blockedByFlag,
      body,
      identity,
    };
  }
  return {
    ok: true,
    status: res.status,
    elapsedMs,
    token: body.token,
    societyId: body.user?.societyId || null,
    societyName: identity.societyName,
    adminEmail: identity.email,
    body,
    identity,
  };
}

// Manual fallback: the user pastes an existing admin/secretary token
// (from a society they already control) instead of auto-provisioning one.
// Still fully lane-isolated -- no cookie involved either way.
export function manualLane({ token, label }) {
  return {
    ok: true,
    token,
    manual: true,
    societyName: label || "Manually supplied society",
  };
}

import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { requireAuth } from "@/lib/authz";
import { authorize, authorizeAny } from "@/lib/rbac/authorize";
import { can, CAPABILITY } from "./permissions";

// Capabilities that correspond to the /admin/amenities MANAGEMENT surface —
// configuration and oversight. Deliberately excludes operational capabilities
// used by security guards and members (SCAN_QR, RECORD_ATTENDANCE,
// SELF_CHECK_IN, REGISTER_EVENT, JOIN_WAITLIST, SPONSOR_VISITOR,
// REPORT_INCIDENT, VIEW_AMENITIES, VIEW_OWN_ATTENDANCE, VERIFY_VISITORS,
// OVERRIDE_ATTENDANCE, ADJUST_ATTENDANCE) — gating those on the admin-only
// RBAC page would break the guard console and member self-service, which
// this capability matrix deliberately keeps role-based, not RBAC-page-based.
const ADMIN_PAGE_LEVEL = {
  [CAPABILITY.MANAGE_CATEGORIES]: "manage",
  [CAPABILITY.MANAGE_AMENITIES]: "manage",
  [CAPABILITY.MANAGE_RULES]: "manage",
  [CAPABILITY.MANAGE_AVAILABILITY]: "manage",
  [CAPABILITY.MANAGE_SLOTS]: "manage",
  [CAPABILITY.MANAGE_CAPACITY]: "manage",
  [CAPABILITY.CHANGE_STATUS]: "manage",
  [CAPABILITY.MANAGE_MAINTENANCE]: "manage",
  [CAPABILITY.CONFIGURE_ATTENDANCE]: "manage",
  [CAPABILITY.CONFIGURE_QR]: "manage",
  [CAPABILITY.MANAGE_SETTINGS]: "manage",
  // Capacity stays on the admin page tier, and nothing below ever relaxes it:
  // this is the enforcement half of "only Admin can change 40 to 50".
  [CAPABILITY.VIEW_CAPACITY]: "view",
  [CAPABILITY.MANAGE_EVENTS]: "manage",
  [CAPABILITY.MANAGE_REGISTRATIONS]: "manage",
  [CAPABILITY.MANAGE_INCIDENTS]: "manage",
  [CAPABILITY.VIEW_ANALYTICS]: "view",
  [CAPABILITY.EXPORT_ANALYTICS]: "view",
  [CAPABILITY.VIEW_ALL_ATTENDANCE]: "view",
  [CAPABILITY.VIEW_INCIDENTS]: "view",
  [CAPABILITY.VIEW_ACTIVITY_LOG]: "view",
};

// Operational capabilities → the clubhouse RBAC leaf that may grant them to a
// token carrying no legacy role string. Module scope, not inside gate(), so the
// object is built once rather than on every request.
const CLUBHOUSE_LEAF_BY_CAPABILITY = {
  [CAPABILITY.CHANGE_STATUS]: "amenities.clubhouse.operate",
  [CAPABILITY.MANAGE_AVAILABILITY]: "amenities.clubhouse.operate",
  [CAPABILITY.MANAGE_SLOTS]: "amenities.clubhouse.operate",
  [CAPABILITY.MANAGE_MAINTENANCE]: "amenities.clubhouse.maintenance",
  [CAPABILITY.VIEW_ALL_ATTENDANCE]: "amenities.clubhouse.view",
  [CAPABILITY.VIEW_INCIDENTS]: "amenities.clubhouse.view",
  [CAPABILITY.MANAGE_INCIDENTS]: "amenities.clubhouse.incident",
  [CAPABILITY.REPORT_INCIDENT]: "amenities.clubhouse.incident",
};

// Shared plumbing for the /api/amenities/* (website) routes.
//
// The repo has two auth layers — cookie JWT for the website (lib/authz) and
// bearer JWT for mobile (lib/v1/auth). Both produce a claims object with
// { userId, role, societyId }, so the amenity routes only need one adapter:
// resolve claims, then check a *capability* rather than re-listing roles in
// every file. That way the permission matrix has exactly one implementation.

export { CAPABILITY };

export function ok(data, init = {}) {
  return NextResponse.json(data, { status: 200, ...init });
}

export function created(data) {
  return NextResponse.json(data, { status: 201 });
}

export function fail(status, message, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function zodFail(parsed) {
  const first = parsed.error?.issues?.[0];
  return NextResponse.json(
    {
      error: first ? `${first.path.join(".") || "body"}: ${first.message}` : "Invalid request",
      issues: parsed.error?.issues || [],
    },
    { status: 422 },
  );
}

export function isId(v) {
  return typeof v === "string" && /^[a-f\d]{24}$/i.test(v);
}

export function toId(v) {
  return new mongoose.Types.ObjectId(String(v));
}

/**
 * Gate a website amenity route on a capability.
 *
 * @returns { ok: true, user, societyId, actor } or { ok: false, response }
 */
export async function gate(request, capability) {
  const auth = requireAuth(request);
  // requireAuth returns a NextResponse on failure (repo convention), so the
  // absence of `valid` is the failure signal.
  if (!auth?.valid) return { ok: false, response: auth };

  const user = auth.user;
  if (!user.societyId) {
    return { ok: false, response: fail(403, "Society context required") };
  }
  const level = ADMIN_PAGE_LEVEL[capability];
  // RBAC-only staff tokens (custom roles built via the wizard) carry no
  // legacy role string at all, so can(undefined, capability) always failed —
  // blocking every admin-config capability outright, before the real RBAC
  // check below ever ran. For capabilities the RBAC page gate already covers,
  // that gate IS the real boundary for an RBAC-only token; the legacy
  // role-string check only applies to tokens that actually carry a role.
  const isRbacStaffToken = !user.role && user.activeContext?.hat === "staff";
  // Every admin GET route (list categories, list amenities, view settings)
  // calls VIEW_AMENITIES — the same capability guards/members use for their
  // own self-service, deliberately kept legacy-role-only. That's correct for
  // a guard/member, but it means an RBAC-only custom role could never open
  // the admin Amenities page at all: not even to VIEW, regardless of what
  // its amenities.admin.view/manage grant says. Whoever holds any amenities
  // admin-page grant can also just view the data.
  if (capability === CAPABILITY.VIEW_AMENITIES && isRbacStaffToken) {
    const rbacGate = await authorize(request, "amenities.admin.view");
    if (!rbacGate.ok) return { ok: false, response: rbacGate.response };
    return { ok: true, user, societyId: user.societyId, actor: actorFrom(request, user) };
  }
  // The admin Amenities page also has its own manual attendance
  // record/checkout/adjust UI (not just the guard console) — those routes
  // reuse RECORD_ATTENDANCE/ADJUST_ATTENDANCE, the same guard-facing
  // capabilities, deliberately kept legacy-role-only for the same reason as
  // VIEW_AMENITIES above. Same fix: an RBAC-only token with amenities manage
  // access can do this from the admin page too.
  if (
    (capability === CAPABILITY.RECORD_ATTENDANCE || capability === CAPABILITY.ADJUST_ATTENDANCE) &&
    isRbacStaffToken
  ) {
    const rbacGate = await authorize(request, "amenities.admin.update");
    if (!rbacGate.ok) return { ok: false, response: rbacGate.response };
    return { ok: true, user, societyId: user.societyId, actor: actorFrom(request, user) };
  }
  // Operational capabilities an RBAC-only custom role ("Clubhouse Manager")
  // can legitimately hold. Same shape of fix as VIEW_AMENITIES and
  // RECORD_ATTENDANCE above, and the same reason: these capabilities are
  // deliberately legacy-role-only, so can(undefined, capability) refused every
  // RBAC-only token outright — which is exactly the "a custom role never
  // reaches the amenity routes" boundary the brief points at.
  //
  // The clubhouse leaf is the real authority here; the legacy role string is
  // simply not present on these tokens to check.
  if (isRbacStaffToken && CLUBHOUSE_LEAF_BY_CAPABILITY[capability]) {
    // authorizeAny, not authorize: an Amenities admin (amenities.admin.update)
    // must keep reaching these routes exactly as before. The clubhouse leaf is
    // additive, never a replacement for the existing grant.
    const rbacGate = await authorizeAny(request, [
      CLUBHOUSE_LEAF_BY_CAPABILITY[capability],
      "amenities.admin.update",
    ]);
    if (!rbacGate.ok) return { ok: false, response: rbacGate.response };
    return { ok: true, user, societyId: user.societyId, actor: actorFrom(request, user) };
  }
  if (capability && !(level && isRbacStaffToken) && !can(user.role, capability)) {
    return { ok: false, response: fail(403, "Insufficient permissions for this action") };
  }
  // RBAC page gate, additive on top of the legacy capability check above
  // (never a replacement for it), and ONLY for the admin-config/oversight
  // capabilities — operational ones stay role-based, untouched.
  if (level) {
    // No permission id in this registry ever uses the literal action "manage"
    // — real actions are view/create/update/delete. "manage" here is only a
    // UI tier label (page-access-map.js), not a leaf id.
    const rbacGate = await authorize(request, `amenities.admin.${level === "manage" ? "update" : level}`);
    if (!rbacGate.ok) return { ok: false, response: rbacGate.response };
  }

  return {
    ok: true,
    user,
    societyId: user.societyId,
    actor: actorFrom(request, user),
  };
}

// Shape the activity log and notification helpers expect.
export function actorFrom(request, user) {
  return {
    userId: user?.userId || user?.id || user?._id || null,
    name: user?.name || user?.fullName || "",
    role: user?.role || "",
    ip: clientIpOf(request),
    userAgent: request?.headers?.get?.("user-agent") || null,
  };
}

export function clientIpOf(request) {
  const h = request?.headers;
  if (!h?.get) return null;
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") || null;
}

// Consistent list pagination across every amenity list endpoint.
export function paging(searchParams, { defaultLimit = 25, maxLimit = 200 } = {}) {
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number(searchParams.get("limit")) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

export function pageMeta({ page, limit, total }) {
  return { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) };
}

// Date range from query params, defaulting to the last 30 days. Every analytics
// and history endpoint uses this so "?from=&to=" behaves identically everywhere.
export function dateRange(searchParams, { defaultDays = 30 } = {}) {
  const toRaw = searchParams.get("to");
  const fromRaw = searchParams.get("from");
  const to = toRaw ? new Date(toRaw) : new Date();
  const from = fromRaw ? new Date(fromRaw) : new Date(to.getTime() - defaultDays * 86400000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  if (from > to) return null;
  return { from, to };
}

// Turns service-layer error codes into HTTP statuses in one place, so a new
// error code does not need a new branch in every route. Exported so routes
// outside the apiHelpers/serviceError framework (e.g. the /v1 mobile routes,
// which use lib/v1/http's ApiError instead) can map the same codes.
export const STATUS_BY_CODE = {
  ALREADY_CHECKED_IN: 409,
  NOT_CHECKED_IN: 409,
  CAPACITY_FULL: 409,
  EVENT_FULL: 409,
  ALREADY_REGISTERED: 409,
  NOT_REGISTERED: 404,
  NOT_QUEUED: 404,
  WAITLIST_DISABLED: 409,
  EVENT_CANCELLED: 409,
  EVENT_NOT_OPEN: 409,
  EVENT_STARTED: 409,
  REGISTRATION_CLOSED: 409,
  NO_REGISTRATION: 400,
  GUESTS_NOT_ALLOWED: 400,
  GUEST_LIMIT: 400,
  AMENITY_CLOSED: 409,
  OUTSIDE_HOURS: 409,
  NOT_ELIGIBLE: 403,
  EXPIRED: 410,
  INVALID_TOKEN: 400,
  REVOKED: 410,
};

export function serviceError(err) {
  if (err?.code && STATUS_BY_CODE[err.code]) {
    return NextResponse.json(
      { error: err.message, code: err.code, ...(err.meta || {}) },
      { status: STATUS_BY_CODE[err.code] },
    );
  }
  if (err?.code === 11000) {
    return fail(409, "That record already exists");
  }
  console.error("[amenities/api]", err?.message || err, err?.stack);
  return fail(500, "Something went wrong. Please try again.");
}

// Wraps a handler so no route has to repeat try/catch + DB connect.
export function withAmenityRoute(handler) {
  return async (request, ctx) => {
    try {
      const { default: connectDB } = await import("@/lib/mongodb");
      await connectDB();
      return await handler(request, ctx);
    } catch (err) {
      return serviceError(err);
    }
  };
}

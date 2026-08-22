/**
 * GET /api/rbac/my-access  (Phase 2)  — powers the "My Roles & Permissions" page
 * ----------------------------------------------------------------------------
 * Required permission : AUTH_ONLY (any authenticated user sees their OWN access)
 * Tenant validation   : scoped to the caller's active societyId from the token
 * Audit behaviour      : none (self read-only)
 * Failure behaviour    : 401 if unauthenticated; fail-closed empty set on error
 */

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import RoleAssignment from "@/models/RoleAssignment";
import Role from "@/models/Role";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { resolveEffectivePermissions, HAT } from "@/lib/rbac/permission-engine";
import { registry } from "@/lib/rbac/registry";
import { summarizePageAccess } from "@/lib/rbac/page-access-map";
import { PAGE_CATALOG } from "@/lib/rbac/page-catalog";
import { getSessionContext, HAT_MEMBER } from "@/lib/auth/session-context";

export async function GET(request) {
  const token = getTokenFromRequest(request);
  if (!token)
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  let decoded;
  try {
    decoded = verifyToken(token);
  } catch {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }
  // Single source of truth for MEMBER vs STAFF — see session-context.js
  // header comment. This used to reimplement the same precedence inline and
  // independently from /api/auth/me, and the two disagreed about identical
  // tokens (me.js took a legacy branch this file never had).
  const session = getSessionContext(decoded);
  const userId = session?.userId || decoded.userId || decoded.sub || decoded.id;
  const societyId = session?.societyId || decoded.societyId || null;
  const hat = session?.hat === HAT_MEMBER ? HAT.MEMBER : HAT.STAFF;
  if (!userId || !societyId) {
    return NextResponse.json(
      { error: "No active society context" },
      { status: 401 },
    );
  }

  try {
    await connectDB();
    const perms = await resolveEffectivePermissions({ userId, societyId, hat });
    const summary = summarizePageAccess(perms);
    const summaryByKey = Object.fromEntries(summary.map((s) => [s.pageKey, s.level]));
    const pages = PAGE_CATALOG.map((p) => ({
      key: p.key,
      label: p.label,
      path: p.path,
      group: p.group,
      level: summaryByKey[p.key] || "none",
    }));
    const assignments =
      hat === HAT.STAFF
        ? await RoleAssignment.find({
            userId,
            societyId,
            status: "active",
          }).lean()
        : [];
    const roleIds = assignments.map((a) => a.roleId);
    const roles = roleIds.length
      ? await Role.find({ _id: { $in: roleIds } })
          .select("name key color")
          .lean()
      : [];

    return NextResponse.json({
      context: { societyId, hat },
      // Staff hat with zero role assignments = RBAC never bootstrapped for
      // this user (see /my-access "Enable Role Management"). The sidebar
      // must NOT read that as "assign this user to nothing" — deny-by-default
      // is still enforced by authorize()/requirePagePermission() underneath;
      // this flag only controls whether the sidebar shows the full menu
      // (pre-RBAC behavior) or the filtered one.
      bootstrapped: hat !== HAT.STAFF || assignments.length > 0,
      roles: roles.map((r) => ({
        id: String(r._id),
        name: r.name,
        key: r.key,
        color: r.color,
      })),
      permissions: [...perms].sort(),
      // grouped view for the UI (module -> [ids])
      grouped: groupByModule([...perms]),
      pagePermissions: registry
        .pagePermissions()
        .filter((p) => perms.has(p.id))
        .map((p) => p.id),
      // Spoon-fed view: every real page, with NONE/VIEW/MANAGE. This is what
      // the /my-access UI and the admin sidebar filter should actually use.
      pages,
    });
  } catch (err) {
    console.error("[rbac] my-access failed (fail-closed):", err?.message);
    return NextResponse.json({
      context: { societyId, hat },
      error: true, // DB/resolution failure — fail CLOSED, not the bootstrap fallback
      bootstrapped: true,
      roles: [],
      permissions: [],
      grouped: {},
      pages: [],
    });
  }
}

function groupByModule(ids) {
  const out = {};
  for (const id of ids) {
    const mod = id.split(".")[0];
    (out[mod] ||= []).push(id);
  }
  return out;
}

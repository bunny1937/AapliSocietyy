/**
 * GET /api/rbac/permissions  (simplified page model)
 * ----------------------------------------------------------------------------
 * Required permission : rbac.role.view
 * Returns the page catalog grouped for the Roles & Access wizard. The admin
 * only ever sees page name + NONE/VIEW/MANAGE — no permission ids, no CRUD
 * matrix. Granular ids stay server-side (lib/rbac/page-access-map.js).
 */

import { NextResponse } from "next/server";
import { authorize } from "@/lib/rbac/authorize";
import { PAGE_CATALOG } from "@/lib/rbac/page-catalog";
import { dangerousActionsForPage } from "@/lib/rbac/dangerous-actions";

export async function GET(request) {
  const gate = await authorize(request, "rbac.role.view");
  if (!gate.ok) return gate.response;

  const groups = new Map();
  for (const p of PAGE_CATALOG) {
    if (!groups.has(p.group)) groups.set(p.group, []);
    // `dangerous` is the one place granular ids reach the client, and only as
    // human labels ("Delete", "Export") attached to the page whose MANAGE
    // level grants them. The admin still never picks a permission id — they
    // pick a level, and this tells them what that level includes.
    const dangerous = dangerousActionsForPage(p.key).map((a) => a.label);
    groups.get(p.group).push({
      key: p.key,
      label: p.label,
      path: p.path,
      adminOnly: !!p.adminOnly,
      dangerous: [...new Set(dangerous)],
    });
  }

  return NextResponse.json({
    groups: [...groups.entries()].map(([group, pages]) => ({ group, pages })),
    total: PAGE_CATALOG.length,
  });
}

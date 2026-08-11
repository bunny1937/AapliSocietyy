/**
 * /admin/rbac/roles — Role management page (Phase 3, server component).
 * ----------------------------------------------------------------------------
 * PAGE GUARD: server-side requirePagePermission() enforces the page-access
 * permission BEFORE any UI renders. A denial redirects to
 * /my-access?denied=rbac.roleManager.view (fail-closed). This is the canonical
 * pattern for wiring page guards in Phase 3 (see docs/PHASE-3-PAGE-GUARDS.md).
 */

import { requirePagePermission } from "@/lib/rbac/page-guard";
import RoleManager from "@/components/rbac/RoleManager";
import { PermissionProvider } from "@/lib/rbac/client/permission-context";

export const dynamic = "force-dynamic";

export default async function RoleManagementPage() {
  await requirePagePermission("rbac.roleManager.view");

  return (
    <PermissionProvider>
      <main className="mx-auto max-w-6xl p-6">
        <h1 className="mb-1 text-2xl font-semibold">Roles &amp; Permissions</h1>
        <p className="mb-6 text-sm text-gray-500">
          Create, clone, and edit staff roles. Members have a fixed capability set
          and are not managed here.
        </p>
        <RoleManager />
      </main>
    </PermissionProvider>
  );
}

"use client";

/**
 * <Can> — component-level guard (Phase 3).
 *
 *   <Can permission="billing.bill.generate">
 *     <GenerateBillsButton />
 *   </Can>
 *
 *   <Can anyOf={["complaint.complaint.approve", "complaint.complaint.reject"]} fallback={<Locked />}>
 *     <ModerationTools />
 *   </Can>
 *
 *   <Can allOf={["rbac.role.update", "rbac.role.delete"]}>{() => <DangerZone />}</Can>
 *
 * Renders `children` only when the guard passes, otherwise `fallback` (default
 * null). While the permission set is still loading, renders nothing to avoid a
 * flash of unauthorized UI. UX only — the server still enforces every action.
 */

import { usePermissionContext } from "@/lib/rbac/client/permission-context";
import { evaluate } from "@/lib/rbac/client/can";

export function Can({
  permission,
  anyOf,
  allOf,
  fallback = null,
  showWhileLoading = false,
  children,
}) {
  const { permissions, loading } = usePermissionContext();
  if (loading) return showWhileLoading ? fallback : null;
  const allowed = evaluate(permissions, { permission, anyOf, allOf });
  if (!allowed) return fallback;
  return typeof children === "function" ? children({ allowed }) : children;
}

export default Can;

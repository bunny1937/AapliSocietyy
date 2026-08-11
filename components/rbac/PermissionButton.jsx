"use client";

/**
 * <PermissionButton> — a control that stays VISIBLE but becomes disabled with an
 * explanatory tooltip when the caller lacks the permission (Phase 3 component
 * guard, "disabled-controls + tooltip" pattern).
 *
 *   <PermissionButton permission="rbac.role.delete" onClick={onDelete}
 *     className="btn btn-danger">Delete role</PermissionButton>
 *
 * Use `hideWhenDenied` to hide instead of disable. Use `as` to render another
 * element/component (e.g. a styled Link). UX only — the server still enforces.
 */

import { usePermissionContext } from "@/lib/rbac/client/permission-context";
import { evaluate } from "@/lib/rbac/client/can";

export function PermissionButton({
  permission,
  anyOf,
  allOf,
  as: Comp = "button",
  hideWhenDenied = false,
  deniedTooltip,
  className = "",
  children,
  ...rest
}) {
  const { permissions, loading } = usePermissionContext();
  const allowed =
    !loading && evaluate(permissions, { permission, anyOf, allOf });

  if (!allowed && hideWhenDenied) return null;

  const tip =
    deniedTooltip ||
    `You don't have permission: ${permission || anyOf?.join(" / ") || allOf?.join(" + ") || ""}`;

  return (
    <span className="group relative inline-block">
      <Comp
        {...rest}
        disabled={rest.disabled || !allowed}
        aria-disabled={!allowed}
        title={!allowed ? tip : rest.title}
        className={`${className} ${!allowed ? "cursor-not-allowed opacity-50" : ""}`.trim()}
      >
        {children}
      </Comp>
      {!allowed ? (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 shadow transition-opacity group-hover:opacity-100"
        >
          {tip}
        </span>
      ) : null}
    </span>
  );
}

export default PermissionButton;

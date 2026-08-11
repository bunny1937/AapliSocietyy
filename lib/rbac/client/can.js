/**
 * Client-side permission matching (shared by hooks, guards, and components).
 *
 * The server endpoint GET /api/rbac/my-access returns the already-RESOLVED
 * EFFECTIVE permission set for the caller's active context (deny-override is
 * applied server-side by resolveEffectivePermissions). The client therefore
 * only performs positive membership matching. Wildcard grants are supported
 * defensively in case an effective set ever contains a
 * "<module>.<resource>.*" or "<module>.*" grant.
 *
 * IMPORTANT: this is a UX convenience only. It NEVER replaces server
 * authorization — every mutation and page load is still gated server-side by
 * authorize() / requirePagePermission(). Hiding a button is not security.
 */

export function canWith(permissionSet, permissionId) {
  if (!permissionId || !permissionSet) return false;
  if (permissionSet.has(permissionId)) return true;
  const parts = permissionId.split(".");
  if (parts.length >= 2 && permissionSet.has(`${parts[0]}.${parts[1]}.*`))
    return true;
  if (parts.length >= 1 && permissionSet.has(`${parts[0]}.*`)) return true;
  return false;
}

/** Evaluate a {permission | anyOf | allOf} guard spec against an effective set. */
export function evaluate(permissionSet, { permission, anyOf, allOf } = {}) {
  if (permission) return canWith(permissionSet, permission);
  if (Array.isArray(anyOf) && anyOf.length)
    return anyOf.some((id) => canWith(permissionSet, id));
  if (Array.isArray(allOf) && allOf.length)
    return allOf.every((id) => canWith(permissionSet, id));
  return false;
}

const capWords = (s) =>
  s
    ? s
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (c) => c.toUpperCase())
        .trim()
    : s;

/** Human-friendly label for a raw permission id, e.g. "Reactivate — User · Rbac". */
export function prettyPermissionId(id) {
  if (!id) return "";
  const [mod, res, action] = id.split(".");
  return `${capWords(action)} — ${capWords(res)} · ${capWords(mod)}`;
}

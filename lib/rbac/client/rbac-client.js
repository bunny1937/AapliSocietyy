/**
 * Thin client-side fetch wrapper for the RBAC HTTP API.
 *
 * - Sends cookies (HttpOnly access token) via credentials: "include".
 * - Parses JSON and throws a typed Error on non-2xx, preserving the server's
 *   structured contract: { error, code, requiredPermission, redirectTo,
 *   activeContext, contactAdmin }.
 * - Honors the 403 -> "/my-access" redirect contract when a hard navigation is
 *   requested by the caller (opts.redirectOnDenied).
 *
 * Deliberately framework-light so it can be reused by any client component
 * without coupling to the app's ApiClient/react-query setup.
 */

export async function rbacFetch(
  path,
  { method = "GET", body, signal, redirectOnDenied = false } = {},
) {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body != null ? JSON.stringify(body) : undefined,
    signal,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty / non-JSON body */
  }

  if (!res.ok) {
    if (
      res.status === 403 &&
      redirectOnDenied &&
      typeof window !== "undefined"
    ) {
      const to = data?.redirectTo || "/my-access";
      const q = data?.requiredPermission
        ? `?denied=${encodeURIComponent(data.requiredPermission)}`
        : "";
      window.location.assign(`${to}${q}`);
    }
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data?.code;
    err.payload = data;
    throw err;
  }
  return data;
}

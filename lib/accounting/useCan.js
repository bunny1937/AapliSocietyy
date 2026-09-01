"use client";
/**
 * §7.15 role-aware gating — one shared hook instead of duplicating the
 * /api/rbac/my-access fetch per page. Same fail-open behaviour everywhere:
 * until permissions load (or if the fetch fails), can() returns true —
 * never blocks on a slow/failed permission check, only hides once it
 * actually knows the answer. Real permission ids only (see call sites).
 */
import { useCallback, useEffect, useState } from "react";

export function useCan() {
  const [perms, setPerms] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/rbac/my-access", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.permissions) setPerms(new Set(d.permissions)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return useCallback((perm) => !perms || perms.has(perm), [perms]);
}

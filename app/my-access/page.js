"use client";

/**
 * /my-access — "My Roles & Permissions" + denial landing (Phase 3, blueprint #8).
 * ----------------------------------------------------------------------------
 * Any authenticated user may view their OWN access here (AUTH_ONLY — this page is
 * intentionally NOT wrapped in requirePagePermission, because it is the
 * destination every page/action denial redirects to). When arrived at via a
 * denial, ?denied=<permissionId> renders an explanatory banner.
 *
 * Reads the effective set from PermissionContext (bootstrapped from
 * GET /api/rbac/my-access).
 */

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { usePermissions } from "@/lib/rbac/client/use-permissions";
import { prettyPermissionId } from "@/lib/rbac/client/can";
import { PermissionProvider } from "@/lib/rbac/client/permission-context";
import { rbacFetch } from "@/lib/rbac/client/rbac-client";
import DashboardLayout from "@/components/DashboardLayout";
import { useVisibleAdminNavigation } from "@/components/adminNavigation";

function MyAccessInner() {
  const sp = useSearchParams();
  const denied = sp.get("denied");
  const { grouped, roles, context, pages, loading, error, refresh } =
    usePermissions();
  const [open, setOpen] = useState({});
  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapError, setBootstrapError] = useState(null);

  async function handleEnableRoleManagement() {
    setBootstrapping(true);
    setBootstrapError(null);
    try {
      await rbacFetch("/api/rbac/bootstrap", { method: "POST" });
      await refresh();
    } catch (e) {
      setBootstrapError(
        e?.status === 403
          ? "Only the society Admin can turn this on."
          : e?.message || "Failed to enable role management.",
      );
    } finally {
      setBootstrapping(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-semibold">My Access</h1>
      <p className="mb-4 text-sm text-gray-500">
        Your roles and effective permissions in this society.
      </p>

      {denied ? (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <div className="font-medium text-amber-800">
            You don’t have access to that feature.
          </div>
          <div className="mt-1 text-sm text-amber-700">
            It requires the permission{" "}
            <code className="rounded bg-amber-100 px-1">{denied}</code> (
            {prettyPermissionId(denied)}). If you need it, contact your society
            admin to have it added to one of your roles.
          </div>
        </div>
      ) : null}

      {/* This is the actual navigation for a staff-hat login — there is no
          sidebar on this page on purpose (it's the landing/denial page and
          has to work even for a role granted nothing yet). Every page the
          caller can actually open is a real link here. */}
      {!loading && !error && context?.hat === "staff" ? (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">
            Where you can go
          </h2>
          {(pages || []).filter((p) => p.level !== "none").length === 0 ? (
            <div className="rounded-lg bg-gray-50 px-3 py-4 text-sm text-gray-400">
              No pages granted yet. Contact your society admin, or if you're
              the admin, use "Enable Role Management" below.
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(
                (pages || [])
                  .filter((p) => p.level !== "none")
                  .reduce((acc, p) => {
                    (acc[p.group] ||= []).push(p);
                    return acc;
                  }, {}),
              ).map(([group, groupPages]) => (
                <div key={group}>
                  <div className="mb-1 text-xs font-semibold uppercase text-gray-400">
                    {group}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {groupPages.map((p) => (
                      <Link
                        key={p.key}
                        href={p.path}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:border-indigo-400 hover:text-indigo-700"
                      >
                        {p.label}
                        <span className="ml-1.5 text-xs text-gray-400">
                          {p.level === "manage" ? "Manage" : "View"}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {loading ? (
        <div className="text-sm text-gray-500">Loading your access…</div>
      ) : error ? (
        <div className="text-sm text-red-600">
          Couldn’t load your access: {error.message}
          <button onClick={refresh} className="ml-2 underline">
            Retry
          </button>
        </div>
      ) : (
        <>
          <section className="mb-5">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">
              Active context
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded bg-gray-100 px-2 py-0.5">
                {context?.hat === "member" ? "Member" : "Staff"} hat
              </span>
              {roles.length ? (
                roles.map((r) => (
                  <span
                    key={r.id}
                    className="flex items-center gap-1 rounded-full border px-2 py-0.5"
                    style={{ borderColor: r.color || "var(--border)" }}
                  >
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: r.color || "var(--fg-5)" }}
                    />
                    {r.name}
                  </span>
                ))
              ) : (
                <span className="text-gray-400">
                  No staff roles (fixed member capabilities)
                </span>
              )}
            </div>
            {context?.hat === "staff" && roles.length === 0 ? (
              <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
                <div className="text-sm text-blue-800">
                  Role management isn’t turned on for this society yet.
                </div>
                <div className="mt-1 text-xs text-blue-700">
                  If you’re the society Admin, enable it to seed the default
                  roles (Admin, Secretary, Accountant, Security) and assign
                  your role.
                </div>
                <button
                  type="button"
                  onClick={handleEnableRoleManagement}
                  disabled={bootstrapping}
                  className="mt-2 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {bootstrapping ? "Enabling…" : "Enable Role Management"}
                </button>
                {bootstrapError ? (
                  <div className="mt-2 text-xs text-red-600">
                    {bootstrapError}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-gray-700">
              Permissions by area
            </h2>
            {Object.keys(grouped).length === 0 ? (
              <div className="text-sm text-gray-400">
                You have no permissions in this context.
              </div>
            ) : (
              <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                {Object.entries(grouped)
                  .sort()
                  .map(([mod, ids]) => {
                    const isOpen = open[mod];
                    return (
                      <div key={mod}>
                        <button
                          type="button"
                          onClick={() =>
                            setOpen((s) => ({ ...s, [mod]: !s[mod] }))
                          }
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium capitalize hover:bg-gray-50"
                        >
                          <span>
                            <span className="mr-1 inline-block w-3 text-gray-400">
                              {isOpen ? "▾" : "▸"}
                            </span>
                            {mod}
                          </span>
                          <span className="rounded-full bg-gray-100 px-2 text-xs text-gray-600">
                            {ids.length}
                          </span>
                        </button>
                        {isOpen ? (
                          <ul className="space-y-0.5 px-8 py-2">
                            {ids.sort().map((id) => (
                              <li
                                key={id}
                                className="flex items-center justify-between text-sm"
                              >
                                <span>{prettyPermissionId(id)}</span>
                                <code className="text-[10px] text-gray-400">
                                  {id}
                                </code>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    );
                  })}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

export default function MyAccessPage() {
  const { visibleNavigation } = useVisibleAdminNavigation();
  return (
    <DashboardLayout role="Staff" navigation={visibleNavigation} title="AapliSociety" subtitle="My Access">
      <PermissionProvider>
        <Suspense
          fallback={
            <div className="p-8 text-sm text-gray-500">Loading your access…</div>
          }
        >
          <MyAccessInner />
        </Suspense>
      </PermissionProvider>
    </DashboardLayout>
  );
}

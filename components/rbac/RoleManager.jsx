"use client";

/**
 * <RoleManager> — role management UI (Phase 3, revised).
 * ----------------------------------------------------------------------------
 * Lists roles and lets an authorized admin create / clone / edit / delete them,
 * restore system-role defaults, and — via the “Assign” action — open the
 * <AssignmentManager> to create login users or assign existing ones.
 *
 * The create/edit editor is now a BIG CENTERED DIALOG over the page (not a side
 * drawer). The permission chooser is the spoon-fed <PageAccessPicker>
 * (NONE/VIEW/MANAGE per page — no raw permission ids shown to the admin).
 * Every mutating control is a <PermissionButton> (visible-but-disabled with a
 * tooltip when the caller lacks the permission); the server still enforces
 * authorization on every request.
 *
 * Backend contract (frozen Phase 2 + Phase 3 additive users route):
 *   GET    /api/rbac/roles                    -> { roles }
 *   POST   /api/rbac/roles                     -> { role, warnings }   (create/clone)
 *   PATCH  /api/rbac/roles/[id]                -> { role, warnings }   (edit)
 *   DELETE /api/rbac/roles/[id]                -> { ok }
 *   GET    /api/rbac/roles/[id]/impact         -> { assignments, users, ... }
 *   POST   /api/rbac/roles/[id]/restore-defaults
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { rbacFetch } from "@/lib/rbac/client/rbac-client";
import { PermissionButton } from "@/components/rbac/PermissionButton";
import { PageAccessPicker } from "@/components/rbac/PageAccessPicker";
import { AssignmentManager } from "@/components/rbac/AssignmentManager";
import { reduceToPageAccess } from "@/lib/rbac/page-access-map";

const EMPTY_DRAFT = {
  name: "",
  description: "",
  color: "var(--accent)",
  pageAccess: [],
};

// Metadata only (name/description/color) — kept separate from
// lib/rbac/system-role-defaults.js so the client bundle never needs the
// server-side permission-expansion logic, just enough to render checkboxes.
// Keys must match SYSTEM_ROLE_DEFAULTS keys in that file.
export const SEED_TEMPLATES = [
  { key: "admin", name: "Admin", description: "Full administrative control of the society.", color: "var(--danger)" },
  { key: "secretary", name: "Secretary", description: "Day-to-day operations: members, notices, complaints, visitors.", color: "var(--accent)" },
  { key: "accountant", name: "Treasurer", description: "Finance, billing, payments, ledger and statements.", color: "var(--success)" },
  { key: "auditor", name: "Auditor", description: "Read-only access to finance, billing and audit records.", color: "#a855f7" },
  { key: "committeeMember", name: "Committee Member", description: "Broad read access with limited management.", color: "#14b8a6" },
  { key: "security", name: "Security", description: "Gate operations: visitor entry/exit, passes and SOS.", color: "var(--warning)" },
  { key: "clubhouseManager", name: "Clubhouse Manager", description: "Runs the clubhouse from the mobile app: scan residents in, attendance, open/close, timings, maintenance, incidents.", color: "#14b8a6" },
];

export function RoleManager() {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editor, setEditor] = useState(null); // { mode, roleId?, draft, warnings?, busy?, err? }
  const [impact, setImpact] = useState(null); // { role, data, busy }
  const [assigning, setAssigning] = useState(null); // role being managed
  const [seedPicked, setSeedPicked] = useState(() => new Set());
  const [seeding, setSeeding] = useState(false);
  const [seedErr, setSeedErr] = useState(null);
  // pageKey -> { label, dangerous[] }. Same payload PageAccessPicker fetches;
  // needed here too so the save review can name pages and destructive actions
  // in the admin's own words rather than echoing page keys back at them.
  const [pageMeta, setPageMeta] = useState(null);

  // Templates the society doesn't have a system role for yet. Keyed by role
  // `key` only (not name) — the whole point of the seed routes' name-clash
  // guard is that a same-named CUSTOM role does not count as "already have
  // this", so it isn't excluded here either; the admin sees it's missing and
  // the seed call itself is what refuses to double it up.
  const missingTemplates = useMemo(() => {
    const seededKeys = new Set(roles.filter((r) => r.isSystem).map((r) => r.key));
    return SEED_TEMPLATES.filter((t) => !seededKeys.has(t.key));
  }, [roles]);

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const data = await rbacFetch("/api/rbac/roles", { signal });
      setRoles(data?.roles || []);
    } catch (e) {
      if (e?.name !== "AbortError") setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  useEffect(() => {
    const ac = new AbortController();
    rbacFetch("/api/rbac/permissions", { signal: ac.signal })
      .then((d) => {
        const map = {};
        for (const g of d?.groups || []) {
          for (const p of g.pages || []) {
            map[p.key] = { label: p.label, dangerous: p.dangerous || [] };
          }
        }
        setPageMeta(map);
      })
      // A failed fetch costs the review its labels, not the ability to save.
      // reviewOf() falls back to page keys and an empty dangerous list.
      .catch(() => setPageMeta({}));
    return () => ac.abort();
  }, []);

  const roleId = (r) => r.id || r._id || r.key;
  const isSystem = (r) => !!(r.isSystem ?? r.system ?? r.locked);

  function openCreate() {
    setEditor({ mode: "create", draft: { ...EMPTY_DRAFT } });
  }
  function openClone(role) {
    setEditor({
      mode: "clone",
      cloneFromRoleId: roleId(role),
      draft: {
        ...EMPTY_DRAFT,
        name: `${role.name} (copy)`,
        color: role.color || EMPTY_DRAFT.color,
        pageAccess: reduceToPageAccess(role.permissions || []),
      },
    });
  }
  function openEdit(role) {
    // The Admin system role is a hardcoded superuser at the server
    // (lib/rbac/permission-engine.js: role.isSystem && role.key === "admin"
    // bypasses every permission check, unconditionally). Its `permissions`
    // list is never actually read for that check, so showing a per-page
    // VIEW/MANAGE picker here would be lying — whatever you toggle here has
    // zero effect on what an Admin can do. Show that plainly instead of a
    // picker that implies otherwise.
    if (role.key === "admin" && isSystem(role)) {
      setEditor({
        mode: "admin-locked",
        roleId: roleId(role),
        draft: { name: role.name, description: role.description, color: role.color },
      });
      return;
    }
    const pageAccess = reduceToPageAccess(role.permissions || []);
    setEditor({
      mode: "edit",
      roleId: roleId(role),
      // What the role could do when the dialog opened. saveEditor() diffs the
      // draft against this to work out what is actually changing — without it
      // there is no way to tell "left Manage alone" from "just granted Manage".
      baseline: pageAccess,
      draft: {
        name: role.name || "",
        description: role.description || "",
        color: role.color || EMPTY_DRAFT.color,
        pageAccess,
      },
    });
  }

  // What is about to change, in the admin's own vocabulary.
  //
  // `lost`      pages this role could open and no longer will, or drops from
  //             Manage to View. Everyone holding the role is forced to re-auth
  //             on save (updateRole, Q11), so this is the half that surprises.
  // `dangerous` pages newly raised to Manage that carry a destructive action.
  //             A grant is not undone by a re-auth; it is undone by noticing.
  function reviewOf(editorState) {
    const meta = pageMeta || {};
    const labelOf = (key) => meta[key]?.label || key;
    const levelIn = (list, key) =>
      list.find((v) => v.pageKey === key)?.level || "none";

    const before = editorState.baseline || [];
    const after = editorState.draft.pageAccess || [];
    const keys = new Set([
      ...before.map((v) => v.pageKey),
      ...after.map((v) => v.pageKey),
    ]);

    const lost = [];
    const dangerous = [];
    for (const key of keys) {
      const was = levelIn(before, key);
      const now = levelIn(after, key);
      if (was === now) continue;
      if (now === "none") lost.push({ label: labelOf(key), detail: "loses access" });
      else if (was === "manage" && now === "view")
        lost.push({ label: labelOf(key), detail: "drops to view only" });
      if (now === "manage" && meta[key]?.dangerous?.length) {
        dangerous.push({ label: labelOf(key), actions: meta[key].dangerous });
      }
    }
    return { lost, dangerous };
  }

  // Step one of saving: decide whether this edit deserves a second look.
  // A create or a purely additive edit goes straight through — a confirmation
  // dialog that always appears is a dialog nobody reads.
  async function saveEditor() {
    if (!editor) return;
    const review = reviewOf(editor);
    if (!review.lost.length && !review.dangerous.length) return commitSave();

    setEditor((s) => ({ ...s, review: { ...review, holders: null }, err: null }));

    // How many people this actually lands on. Only meaningful for an existing
    // role, and only worth blocking the dialog on if it answers quickly — a
    // failed count leaves the review standing without it.
    if (editor.mode === "edit" && editor.roleId) {
      try {
        const data = await rbacFetch(`/api/rbac/roles/${editor.roleId}/impact`);
        setEditor((s) =>
          s?.review
            ? { ...s, review: { ...s.review, holders: data?.affectedUserCount ?? null } }
            : s,
        );
      } catch {
        /* count is a nicety; the review stands without it */
      }
    }
  }

  async function commitSave() {
    if (!editor) return;
    setEditor((s) => ({ ...s, busy: true, err: null, warnings: null, review: null }));
    try {
      const { draft, mode, roleId: id, cloneFromRoleId } = editor;
      const body = {
        name: draft.name,
        description: draft.description,
        color: draft.color,
        pageAccess: draft.pageAccess,
      };
      let res;
      if (mode === "edit") {
        res = await rbacFetch(`/api/rbac/roles/${id}`, {
          method: "PATCH",
          body,
        });
      } else {
        res = await rbacFetch("/api/rbac/roles", {
          method: "POST",
          body: cloneFromRoleId ? { ...body, cloneFromRoleId } : body,
        });
      }
      if (res?.warnings?.length) {
        setEditor((s) => ({ ...s, busy: false, warnings: res.warnings }));
      } else {
        setEditor(null);
      }
      await load();
    } catch (e) {
      const extra =
        e?.code === "UNKNOWN_PERMISSIONS" && e?.payload?.unknown
          ? ` (${e.payload.unknown.join(", ")})`
          : "";
      setEditor((s) => ({ ...s, busy: false, err: e.message + extra }));
    }
  }

  async function openImpact(role) {
    setImpact({ role, busy: true, data: null });
    try {
      const data = await rbacFetch(`/api/rbac/roles/${roleId(role)}/impact`);
      setImpact({ role, busy: false, data });
    } catch (e) {
      setImpact({ role, busy: false, data: null, err: e.message });
    }
  }

  async function confirmDelete() {
    if (!impact?.role) return;
    setImpact((s) => ({ ...s, busy: true }));
    try {
      await rbacFetch(`/api/rbac/roles/${roleId(impact.role)}`, {
        method: "DELETE",
      });
      setImpact(null);
      await load();
    } catch (e) {
      setImpact((s) => ({ ...s, busy: false, err: e.message }));
    }
  }

  function toggleSeedPick(key) {
    setSeedPicked((s) => {
      const next = new Set(s);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function seedTemplates(roleKeys) {
    setSeeding(true);
    setSeedErr(null);
    try {
      const res = await rbacFetch("/api/rbac/bootstrap", {
        method: "POST",
        body: { roleKeys },
      });
      if (res?.nameCollisions?.length) {
        setSeedErr(
          res.nameCollisions
            .map((c) => `"${c.name}" skipped — a custom role with that exact name already exists.`)
            .join(" "),
        );
      }
      setSeedPicked(new Set());
      await load();
    } catch (e) {
      setSeedErr(e.message);
    } finally {
      setSeeding(false);
    }
  }

  async function restoreDefaults(role) {
    try {
      await rbacFetch(`/api/rbac/roles/${roleId(role)}/restore-defaults`, {
        method: "POST",
      });
      await load();
    } catch (e) {
      setError(e);
    }
  }

  if (loading)
    return <div className="p-6 text-sm text-gray-500">Loading roles…</div>;
  if (error)
    return (
      <div className="p-6 text-sm text-red-600">
        Failed to load roles: {error.message}
      </div>
    );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Create a role, choose what it can do, then use <strong>Assign</strong>{" "}
          to create logins or add people to it.
        </p>
        <PermissionButton
          permission="rbac.role.create"
          onClick={openCreate}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white"
        >
          + New role
        </PermissionButton>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Permissions</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {roles.map((r) => (
              <tr key={roleId(r)}>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ backgroundColor: r.color || "var(--fg-5)" }}
                    />
                    <span className="font-medium">{r.name}</span>
                  </span>
                  {r.description ? (
                    <div className="text-xs text-gray-400">{r.description}</div>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  {isSystem(r) ? (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                      System
                    </span>
                  ) : (
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      Custom
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-500">
                  {(r.permissions || []).length} allowed
                  {(r.denies || []).length
                    ? ` · ${(r.denies || []).length} blocked`
                    : ""}
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    <PermissionButton
                      permission="rbac.assignment.view"
                      onClick={() => setAssigning(r)}
                      className="rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                    >
                      Assign
                    </PermissionButton>
                    <PermissionButton
                      permission="rbac.role.create"
                      onClick={() => openClone(r)}
                      className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs"
                    >
                      Clone
                    </PermissionButton>
                    <PermissionButton
                      permission="rbac.role.update"
                      onClick={() => openEdit(r)}
                      className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs"
                    >
                      Edit
                    </PermissionButton>
                    {isSystem(r) ? (
                      <PermissionButton
                        permission="rbac.role.restoreDefaults"
                        onClick={() => restoreDefaults(r)}
                        className="rounded-lg border border-amber-300 px-2.5 py-1 text-xs text-amber-700"
                      >
                        Restore defaults
                      </PermissionButton>
                    ) : (
                      <PermissionButton
                        permission="rbac.role.delete"
                        onClick={() => openImpact(r)}
                        className="rounded-lg border border-red-300 px-2.5 py-1 text-xs text-red-600"
                      >
                        Delete
                      </PermissionButton>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {roles.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-gray-400">
                  No roles yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {missingTemplates.length > 0 ? (
        <div className="mt-4 rounded-lg border border-gray-200 p-4">
          <h3 className="mb-1 text-sm font-semibold text-gray-700">
            {roles.length === 0 ? "Seed starter roles" : "Add more starter roles"}
          </h3>
          <p className="mb-3 text-xs text-gray-500">
            {roles.length === 0
              ? "Pick the roles you actually need — you don't have to seed all of them at once. Each one is still fully editable afterward."
              : "These standard roles haven't been added to this society yet. Pick any you need — each one is still fully editable afterward."}
          </p>
          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {missingTemplates.map((t) => (
              <label
                key={t.key}
                className="flex items-start gap-2 rounded-lg border border-gray-200 p-2 text-sm hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={seedPicked.has(t.key)}
                  onChange={() => toggleSeedPick(t.key)}
                />
                <span>
                  <span className="flex items-center gap-1.5 font-medium text-gray-800">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: t.color }}
                    />
                    {t.name}
                  </span>
                  <span className="text-xs text-gray-400">{t.description}</span>
                </span>
              </label>
            ))}
          </div>
          {seedErr ? (
            <div className="mb-2 text-xs text-red-600">{seedErr}</div>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={seeding || seedPicked.size === 0}
              onClick={() => seedTemplates([...seedPicked])}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {seeding ? "Seeding…" : `Seed selected (${seedPicked.size})`}
            </button>
            <button
              type="button"
              disabled={seeding}
              onClick={() => seedTemplates(missingTemplates.map((t) => t.key))}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 disabled:opacity-50"
            >
              Seed all
            </button>
          </div>
        </div>
      ) : null}

      {/* ── Admin role: explainer instead of a picker that would lie ───────── */}
      {editor?.mode === "admin-locked" ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="mb-2 text-sm font-semibold text-gray-900">
              Admin always has full access
            </h3>
            <p className="mb-3 text-sm text-gray-600">
              Admin is a superuser — it can do everything in the society, and that never
              depends on a per-page list. There is nothing to turn off here, which is why
              this role has no page-access picker like the others do.
            </p>
            <p className="mb-4 text-sm text-gray-600">
              To control who <em>has</em> the Admin role, use <strong>Assign</strong> on the
              roles list — grant it to someone there, or remove it from someone who
              shouldn't have it. That's the only lever for this role.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setEditor(null)}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Create / edit / clone: BIG CENTERED DIALOG ─────────────────────── */}
      {editor && editor.mode !== "admin-locked" ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-semibold">
                {editor.mode === "edit"
                  ? "Edit role"
                  : editor.mode === "clone"
                    ? "Clone role"
                    : "New role"}
              </h2>
              <button
                type="button"
                onClick={() => setEditor(null)}
                className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-auto px-6 py-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-gray-700">
                    Role name
                  </span>
                  <input
                    value={editor.draft.name}
                    onChange={(e) =>
                      setEditor((s) => ({
                        ...s,
                        draft: { ...s.draft, name: e.target.value },
                      }))
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                    placeholder="e.g. Front-desk staff"
                  />
                </label>
                <label className="flex items-end gap-2 text-sm">
                  <span className="font-medium text-gray-700">Colour</span>
                  <input
                    type="color"
                    value={editor.draft.color}
                    onChange={(e) =>
                      setEditor((s) => ({
                        ...s,
                        draft: { ...s.draft, color: e.target.value },
                      }))
                    }
                    className="h-9 w-12 rounded border border-gray-300"
                  />
                </label>
              </div>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">
                  Description{" "}
                  <span className="font-normal text-gray-400">(optional)</span>
                </span>
                <textarea
                  value={editor.draft.description}
                  onChange={(e) =>
                    setEditor((s) => ({
                      ...s,
                      draft: { ...s.draft, description: e.target.value },
                    }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  rows={2}
                  placeholder="What is this role for?"
                />
              </label>

              <div>
                <span className="mb-1 block text-sm font-medium text-gray-700">
                  Which pages can this role open?
                </span>
                <PageAccessPicker
                  value={editor.draft.pageAccess}
                  onChange={(next) =>
                    setEditor((s) => ({
                      ...s,
                      draft: { ...s.draft, pageAccess: next },
                    }))
                  }
                />
              </div>

              {editor.warnings?.length ? (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                  <strong>Some permissions were trimmed:</strong>
                  <ul className="ml-4 list-disc">
                    {editor.warnings.map((w, i) => (
                      <li key={i}>
                        {typeof w === "string"
                          ? w
                          : w.message ||
                            (w.refused ? w.refused.join(", ") : "trimmed")}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {editor.err ? (
                <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700">
                  {editor.err}
                </div>
              ) : null}
            </div>

            {editor.review ? (
              <div className="border-t bg-gray-50 px-6 py-4 text-sm">
                <p className="mb-3 font-semibold text-gray-800">
                  Before you save
                </p>

                {editor.review.lost.length ? (
                  <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
                    <p className="mb-1 text-xs font-semibold text-amber-800">
                      {editor.review.holders === null
                        ? "Anyone holding this role"
                        : editor.review.holders === 1
                          ? "1 person holds this role and"
                          : `${editor.review.holders} people hold this role and`}{" "}
                      will be signed out and lose:
                    </p>
                    <ul className="ml-4 list-disc text-xs text-amber-900">
                      {editor.review.lost.map((l) => (
                        <li key={l.label}>
                          {l.label} — {l.detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {editor.review.dangerous.length ? (
                  <div className="mb-3 rounded-lg border border-red-300 bg-red-50 p-3">
                    <p className="mb-1 text-xs font-semibold text-red-800">
                      This role will be able to do things that cannot be undone:
                    </p>
                    <ul className="ml-4 list-disc text-xs text-red-900">
                      {editor.review.dangerous.map((d) => (
                        <li key={d.label}>
                          <strong>{d.label}</strong> — {d.actions.join(", ").toLowerCase()}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditor((s) => ({ ...s, review: null }))}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm"
                  >
                    Go back
                  </button>
                  <button
                    type="button"
                    disabled={editor.busy}
                    onClick={commitSave}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {editor.busy ? "Saving…" : "Save anyway"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex justify-end gap-2 border-t px-6 py-4">
                <button
                  type="button"
                  onClick={() => setEditor(null)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={editor.busy || !editor.draft.name.trim()}
                  onClick={saveEditor}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {editor.busy ? "Saving…" : "Save role"}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* ── Delete impact preview ──────────────────────────────────────────── */}
      {impact ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="mb-2 text-sm font-semibold text-red-600">
              Delete role “{impact.role.name}”?
            </h3>
            {impact.busy && !impact.data ? (
              <p className="text-sm text-gray-500">Loading impact…</p>
            ) : impact.err ? (
              <p className="text-sm text-red-600">{impact.err}</p>
            ) : (
              <div className="mb-3 space-y-1 text-sm text-gray-600">
                <p>This will remove the role from everyone who has it.</p>
                <ul className="ml-4 list-disc">
                  <li>
                    Affected assignments:{" "}
                    <strong>
                      {impact.data?.assignments ??
                        impact.data?.assignmentCount ??
                        0}
                    </strong>
                  </li>
                  <li>
                    Affected users:{" "}
                    <strong>
                      {impact.data?.users ?? impact.data?.userCount ?? 0}
                    </strong>
                  </li>
                </ul>
                <p className="text-xs text-amber-700">
                  People losing access will be signed out and asked to log in
                  again.
                </p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setImpact(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={impact.busy}
                onClick={confirmDelete}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {impact.busy ? "Deleting…" : "Delete role"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Manage access (create login / assign) ──────────────────────────── */}
      {assigning ? (
        <AssignmentManager
          role={assigning}
          onClose={() => setAssigning(null)}
          onChanged={() => load()}
        />
      ) : null}
    </div>
  );
}

export default RoleManager;

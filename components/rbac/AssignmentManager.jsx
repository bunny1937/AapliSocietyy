"use client";

/**
 * <AssignmentManager> — manage who can log in with a given role (Phase 3).
 * ----------------------------------------------------------------------------
 * Opened from the “Assign” action on a role. Answers the whole “where do I
 * create the user?” question in one place:
 *
 *   1. People with this role  — list + remove (unassign).
 *   2. Create a new login     — name / email / username / password. On save the
 *      account is created AND auto-assigned this role, and the credentials can
 *      immediately sign in to the restricted system.
 *   3. Assign an existing user — pick a staff account that doesn’t have it yet.
 *
 * Every mutating control is a <PermissionButton>, so it stays visible but
 * disabled (with tooltip) when the admin lacks the permission. The server
 * still authorizes every request.
 *
 * Backend:
 *   GET  /api/rbac/users?roleId=<id>   -> { users:[{id,name,email,username,status,roles[]}] }
 *   GET  /api/rbac/users               -> all society staff (for “assign existing”)
 *   POST /api/rbac/users               -> { user, assignment }   (create + assign)
 *   POST /api/rbac/assignments         -> assign existing { userId, roleId }
 *   DELETE /api/rbac/assignments/[id]  -> unassign
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { rbacFetch } from "@/lib/rbac/client/rbac-client";
import { PermissionButton } from "@/components/rbac/PermissionButton";

function randomPassword(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#$%";
  let out = "";
  const arr = new Uint32Array(len);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
    for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
  } else {
    for (let i = 0; i < len; i++)
      out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

const EMPTY_NEW = { name: "", email: "", username: "", password: "" };

export function AssignmentManager({ role, onClose, onChanged }) {
  const roleId = role?.id || role?._id || role?.key;

  const [members, setMembers] = useState([]); // users holding this role
  const [allUsers, setAllUsers] = useState([]); // all society staff
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("create"); // 'create' | 'existing'

  // create-user form state
  const [draft, setDraft] = useState({ ...EMPTY_NEW });
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState(null);
  const [created, setCreated] = useState(null); // last-created creds banner

  // assign-existing state
  const [pickUserId, setPickUserId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignErr, setAssignErr] = useState(null);

  const load = useCallback(
    async (signal) => {
      setLoading(true);
      setError(null);
      try {
        const [withRole, all] = await Promise.all([
          rbacFetch(`/api/rbac/users?roleId=${encodeURIComponent(roleId)}`, {
            signal,
          }),
          rbacFetch("/api/rbac/users", { signal }),
        ]);
        setMembers(withRole?.users || []);
        setAllUsers(all?.users || []);
      } catch (e) {
        if (e?.name !== "AbortError") setError(e);
      } finally {
        setLoading(false);
      }
    },
    [roleId],
  );

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const haveIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);
  const assignable = useMemo(
    () => allUsers.filter((u) => !haveIds.has(u.id)),
    [allUsers, haveIds],
  );

  function friendlyErr(e) {
    if (e?.code === "PRIVILEGE_ESCALATION")
      return "You can only grant a role that stays within your own permissions.";
    return e?.message || "Something went wrong.";
  }

  async function createAndAssign() {
    setCreating(true);
    setCreateErr(null);
    setCreated(null);
    try {
      const res = await rbacFetch("/api/rbac/users", {
        method: "POST",
        body: { ...draft, roleId },
      });
      // Keep a copy of the credentials to show the admin once.
      setCreated({
        name: res?.user?.name || draft.name,
        login: draft.username || draft.email,
        password: draft.password,
      });
      setDraft({ ...EMPTY_NEW });
      await load();
      onChanged?.();
    } catch (e) {
      setCreateErr(friendlyErr(e));
    } finally {
      setCreating(false);
    }
  }

  async function assignExisting() {
    if (!pickUserId) return;
    setAssigning(true);
    setAssignErr(null);
    try {
      await rbacFetch("/api/rbac/assignments", {
        method: "POST",
        body: { userId: pickUserId, roleId },
      });
      setPickUserId("");
      await load();
      onChanged?.();
    } catch (e) {
      setAssignErr(friendlyErr(e));
    } finally {
      setAssigning(false);
    }
  }

  async function unassign(member) {
    const a = (member.roles || []).find(
      (x) => String(x.roleId) === String(roleId),
    );
    if (!a) return;
    if (
      !window.confirm(
        `Remove this role from ${member.name}? They will be signed out and lose the related access.`,
      )
    )
      return;
    try {
      await rbacFetch(`/api/rbac/assignments/${a.assignmentId}`, {
        method: "DELETE",
      });
      await load();
      onChanged?.();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* header */}
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Manage access
            </h2>
            <p className="flex items-center gap-2 text-sm text-gray-500">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: role?.color || "#9ca3af" }}
              />
              Role: <span className="font-medium">{role?.name}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-auto px-5 py-4">
          {/* people with this role */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-gray-700">
              People with this role{" "}
              <span className="text-gray-400">({members.length})</span>
            </h3>
            {loading ? (
              <p className="text-sm text-gray-400">Loading…</p>
            ) : members.length === 0 ? (
              <p className="rounded-lg bg-gray-50 px-3 py-4 text-center text-sm text-gray-400">
                No one has this role yet. Create a login below — they’ll be able
                to sign in right away.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                {members.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-gray-800">
                        {m.name}
                        {m.status === "suspended" ? (
                          <span className="ml-2 rounded bg-red-100 px-1.5 text-[10px] text-red-700">
                            suspended
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate text-xs text-gray-500">
                        {m.username ? `@${m.username}` : ""}
                        {m.username && m.email ? " · " : ""}
                        {m.email}
                      </div>
                    </div>
                    <PermissionButton
                      permission="rbac.assignment.unassign"
                      onClick={() => unassign(m)}
                      className="rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
                    >
                      Remove
                    </PermissionButton>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              {error.message}
            </div>
          ) : null}

          {/* add someone */}
          <section className="rounded-xl border border-gray-200">
            <div className="flex border-b border-gray-100">
              <button
                type="button"
                onClick={() => setTab("create")}
                className={
                  "flex-1 px-4 py-2.5 text-sm font-medium " +
                  (tab === "create"
                    ? "border-b-2 border-indigo-500 text-indigo-600"
                    : "text-gray-500 hover:text-gray-700")
                }
              >
                Create a new login
              </button>
              <button
                type="button"
                onClick={() => setTab("existing")}
                className={
                  "flex-1 px-4 py-2.5 text-sm font-medium " +
                  (tab === "existing"
                    ? "border-b-2 border-indigo-500 text-indigo-600"
                    : "text-gray-500 hover:text-gray-700")
                }
              >
                Assign an existing person
              </button>
            </div>

            {tab === "create" ? (
              <div className="space-y-3 p-4">
                {created ? (
                  <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                    <div className="font-semibold">
                      ✓ {created.name}’s login is ready
                    </div>
                    <div className="mt-1">
                      Give them these credentials — shown once:
                    </div>
                    <div className="mt-1 font-mono text-xs">
                      login: <strong>{created.login}</strong>
                      <br />
                      password: <strong>{created.password}</strong>
                    </div>
                  </div>
                ) : null}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-gray-700">
                      Full name
                    </span>
                    <input
                      value={draft.name}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, name: e.target.value }))
                      }
                      className="w-full rounded-lg border border-gray-300 px-3 py-2"
                      placeholder="e.g. Priya Sharma"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-gray-700">
                      Email{" "}
                      <span className="font-normal text-gray-400">
                        (optional)
                      </span>
                    </span>
                    <input
                      type="email"
                      value={draft.email}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, email: e.target.value }))
                      }
                      className="w-full rounded-lg border border-gray-300 px-3 py-2"
                      placeholder="name@example.com"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-gray-700">
                      Username
                    </span>
                    <input
                      value={draft.username}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, username: e.target.value }))
                      }
                      className="w-full rounded-lg border border-gray-300 px-3 py-2"
                      placeholder="e.g. priya.s"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-gray-700">
                      Password
                    </span>
                    <div className="flex gap-1">
                      <input
                        value={draft.password}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, password: e.target.value }))
                        }
                        className="w-full rounded-lg border border-gray-300 px-3 py-2"
                        placeholder="at least 8 characters"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            password: randomPassword(),
                          }))
                        }
                        className="whitespace-nowrap rounded-lg border border-gray-300 px-2 text-xs text-gray-600 hover:bg-gray-50"
                        title="Generate a strong password"
                      >
                        Generate
                      </button>
                    </div>
                  </label>
                </div>

                <p className="text-xs text-gray-400">
                  Provide an email, a username, or both — they can sign in with
                  whichever you set. This person will be able to log in
                  immediately and use only what this role allows.
                </p>

                {createErr ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                    {createErr}
                  </div>
                ) : null}

                <div className="flex justify-end">
                  <PermissionButton
                    permission="rbac.user.create"
                    onClick={createAndAssign}
                    disabled={creating || !draft.name.trim()}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {creating ? "Creating…" : "Create login & assign role"}
                  </PermissionButton>
                </div>
              </div>
            ) : (
              <div className="space-y-3 p-4">
                {assignable.length === 0 ? (
                  <p className="text-sm text-gray-400">
                    Everyone already has this role, or there's no other
                    member/staff account yet.
                  </p>
                ) : (
                  <>
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-gray-700">
                        Choose a person
                      </span>
                      <span className="mb-1 block text-xs text-gray-400">
                        Existing members and staff accounts in this society.
                        Picking a member adds this role as an extra profile —
                        it doesn't create a duplicate account.
                      </span>
                      <select
                        value={pickUserId}
                        onChange={(e) => setPickUserId(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2"
                      >
                        <option value="">Select…</option>
                        {assignable.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                            {u.flat ? ` — Flat ${u.flat}` : ""}
                            {u.email ? ` (${u.email})` : ""}
                            {u.role === "Member" ? "" : ` [${u.role}]`}
                          </option>
                        ))}
                      </select>
                    </label>
                    {assignErr ? (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                        {assignErr}
                      </div>
                    ) : null}
                    <div className="flex justify-end">
                      <PermissionButton
                        permission="rbac.assignment.assign"
                        onClick={assignExisting}
                        disabled={assigning || !pickUserId}
                        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        {assigning ? "Assigning…" : "Assign this role"}
                      </PermissionButton>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        </div>

        <div className="flex justify-end border-t px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default AssignmentManager;

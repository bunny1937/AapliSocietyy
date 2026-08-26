"use client";
import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import notify from "@/lib/notify";

// Platform settings.
//
// Every field here was an environment variable that needed a redeploy to
// change. The ones that matter are windows measured in days — how long a
// society has to collect its records, how long after a lapse it goes read-only
// — and needing a deploy to adjust those meant they never got adjusted.
//
// Two things the UI has to make obvious, because getting either wrong is how a
// settings page becomes dangerous:
//
//   1. WHERE the current value comes from. A value shown without its source
//      invites somebody to "fix" a number in the UI that an env var is still
//      overriding, or to assume a default is a deliberate choice.
//   2. WHAT the setting does at its extremes. "Minimum grace: 7" means nothing
//      on its own; "the floor on how soon a soft-deleted society can be purged"
//      is a sentence somebody can reason about at the moment they are typing.

const SOURCE = {
  database: { label: "set here", fg: "var(--success-fg, #15803d)" },
  environment: { label: "from env", fg: "#b45309" },
  default: { label: "default", fg: "var(--fg-2, #6b7280)" },
};

async function get(url) {
  const res = await fetch(url, { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load");
  return res.json();
}

const card = {
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: 10,
  padding: "18px 20px",
  marginBottom: 20,
  background: "var(--bg-1, #fff)",
};
const btn = (bg = "var(--fg-3, #f3f4f6)", fg = "inherit") => ({
  background: bg,
  color: fg,
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: 5,
  fontSize: "0.75rem",
  padding: "5px 12px",
  cursor: "pointer",
});
const input = {
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: 5,
  padding: "5px 9px",
  fontSize: "0.82rem",
  background: "var(--bg-input, #fff)",
  color: "inherit",
  width: "100%",
  maxWidth: 320,
};

export default function PageClient() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["superadmin-settings"],
    queryFn: () => get("/api/superadmin/settings"),
  });

  const groups = useMemo(() => {
    if (!data?.settings) return [];
    const map = new Map();
    for (const s of data.settings) {
      if (!map.has(s.group)) map.set(s.group, []);
      map.get(s.group).push(s);
    }
    return [...map.entries()];
  }, [data]);

  const dirty = Object.keys(draft);
  const needsReason = dirty.some((k) => data?.settings.find((s) => s.key === k)?.reasonRequired);

  function edit(key, value) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function save() {
    if (!dirty.length) return;

    let reason = "";
    if (needsReason) {
      const labels = dirty
        .map((k) => data.settings.find((s) => s.key === k))
        .filter((s) => s?.reasonRequired)
        .map((s) => s.label)
        .join(", ");
      reason = await notify.prompt(
        `Changing ${labels} widens a limit or disables a safety.\n\n` +
          "Why? This is recorded permanently against your name — an unexplained change in a year-old audit log is indistinguishable from a mistake.",
      );
      if (!reason || reason.trim().length < 10) {
        notify.error("A written reason of at least 10 characters is required.");
        return;
      }
    }

    setSaving(true);
    try {
      const res = await fetch("/api/superadmin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ changes: draft, reason }),
      });
      const body = await res.json();
      if (!res.ok) {
        notify.error(body.error || "Save failed");
        return;
      }
      notify.success(`${body.applied.length} setting(s) saved. In force within a minute.`);
      setDraft({});
      queryClient.invalidateQueries(["superadmin-settings"]);
    } catch (e) {
      notify.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function reset(s) {
    if (!(await notify.confirm(`Reset ${s.label} to its default?`))) return;
    const res = await fetch("/api/superadmin/settings", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ key: s.key }),
    });
    const body = await res.json();
    if (!res.ok) {
      notify.error(body.error || "Reset failed");
      return;
    }
    notify.success(`${s.label} reset to ${String(body.value)}.`);
    setDraft((d) => {
      const { [s.key]: _drop, ...rest } = d;
      return rest;
    });
    queryClient.invalidateQueries(["superadmin-settings"]);
  }

  if (isLoading) return <div style={{ padding: 40, color: "var(--fg-2)" }}>Loading settings…</div>;
  if (error)
    return (
      <div style={{ padding: 40, color: "var(--danger-fg, #b91c1c)" }}>
        Could not load settings: {error.message}
      </div>
    );

  return (
    <div style={{ padding: "24px 28px", maxWidth: 980 }}>
      <h1 style={{ fontSize: "1.35rem", margin: "0 0 4px" }}>Platform settings</h1>
      <p style={{ color: "var(--fg-2, #6b7280)", fontSize: "0.82rem", margin: "0 0 20px", maxWidth: 720 }}>
        These take effect within a minute of saving, on every server, with no redeploy. A value set
        here overrides its environment variable; resetting falls back through the environment
        variable to the code default, so a setting can never end up unset.
      </p>

      {dirty.length > 0 && (
        <div
          style={{
            ...card,
            position: "sticky",
            top: 0,
            zIndex: 5,
            background: "var(--bg-2, #f8fafc)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: "0.85rem" }}>
            <strong>{dirty.length}</strong> unsaved change{dirty.length === 1 ? "" : "s"}
            {needsReason && (
              <span style={{ color: "#b45309", marginLeft: 8, fontSize: "0.78rem" }}>
                — one of these needs a written reason
              </span>
            )}
          </span>
          <span>
            <button style={btn()} onClick={() => setDraft({})} disabled={saving}>
              Discard
            </button>{" "}
            <button style={btn("var(--primary, #111)", "#fff")} onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </span>
        </div>
      )}

      {groups.map(([group, rows]) => (
        <div key={group} style={card}>
          <h2 style={{ fontSize: "0.95rem", margin: "0 0 14px" }}>{group}</h2>
          {rows.map((s) => {
            const current = s.key in draft ? draft[s.key] : s.value;
            const changed = s.key in draft;
            const src = SOURCE[s.source] || SOURCE.default;
            return (
              <div
                key={s.key}
                style={{
                  padding: "14px 0",
                  borderTop: "1px solid var(--border-subtle, #f1f5f9)",
                  display: "grid",
                  gridTemplateColumns: "minmax(200px, 1fr) minmax(240px, 340px)",
                  gap: 20,
                  alignItems: "start",
                }}
              >
                <div>
                  <div style={{ fontSize: "0.86rem", fontWeight: 600 }}>
                    {s.label}
                    {s.reasonRequired && (
                      <span style={{ color: "#b45309", fontSize: "0.62rem", marginLeft: 6 }}>
                        NEEDS A REASON
                      </span>
                    )}
                  </div>
                  <div style={{ color: "var(--fg-2, #6b7280)", fontSize: "0.72rem", marginTop: 3 }}>
                    <code>{s.env}</code> · <span style={{ color: src.fg }}>{src.label}</span>
                    {s.updatedAt && (
                      <>
                        {" · "}
                        {new Date(s.updatedAt).toLocaleDateString("en-IN")}
                        {s.updatedBy ? ` by ${s.updatedBy}` : ""}
                      </>
                    )}
                  </div>
                  {/* The reason the field exists, next to the field. */}
                  <div
                    style={{
                      fontSize: "0.76rem",
                      lineHeight: 1.6,
                      color: "var(--fg-3, #4b5563)",
                      marginTop: 6,
                      maxWidth: 560,
                    }}
                  >
                    {s.why}
                  </div>
                </div>

                <div>
                  {s.type === "bool" ? (
                    <select
                      style={input}
                      value={String(current)}
                      onChange={(e) => edit(s.key, e.target.value === "true")}
                    >
                      <option value="true">Enabled</option>
                      <option value="false">Disabled</option>
                    </select>
                  ) : s.type === "list" ? (
                    <textarea
                      style={{ ...input, minHeight: 60, fontFamily: "monospace", fontSize: "0.75rem" }}
                      value={Array.isArray(current) ? current.join(", ") : String(current || "")}
                      placeholder="empty — nobody"
                      onChange={(e) => edit(s.key, e.target.value)}
                    />
                  ) : (
                    <input
                      style={input}
                      type={s.type === "int" ? "number" : "text"}
                      value={current ?? ""}
                      min={s.min ?? undefined}
                      max={s.max ?? undefined}
                      placeholder={String(s.fallback)}
                      onChange={(e) =>
                        edit(s.key, s.type === "int" ? Number(e.target.value) : e.target.value)
                      }
                    />
                  )}

                  <div style={{ marginTop: 6, fontSize: "0.7rem", color: "var(--fg-2, #6b7280)" }}>
                    {s.type === "int" && s.min != null && (
                      <span>
                        {s.min}–{s.max} ·{" "}
                      </span>
                    )}
                    default {Array.isArray(s.fallback) ? s.fallback.join(", ") || "empty" : String(s.fallback)}
                    {s.source === "database" && (
                      <>
                        {" · "}
                        <button
                          style={{
                            ...btn(),
                            padding: "1px 7px",
                            fontSize: "0.68rem",
                          }}
                          onClick={() => reset(s)}
                        >
                          reset
                        </button>
                      </>
                    )}
                  </div>

                  {changed && (
                    <div style={{ marginTop: 6, fontSize: "0.72rem", color: "#b45309" }}>
                      was {Array.isArray(s.value) ? s.value.join(", ") || "empty" : String(s.value)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}

      <p style={{ fontSize: "0.75rem", color: "var(--fg-2, #6b7280)", lineHeight: 1.7 }}>
        Not editable here on purpose: <code>CRON_SECRET</code>, <code>JWT_SECRET</code>,{" "}
        <code>MONGODB_URI</code>, the Brevo and Redis credentials. A secret that can be read back out
        of a web page is not a secret, and one that can be changed from a web page can lock every
        server out of the database from a single mistyped field.
      </p>
    </div>
  );
}

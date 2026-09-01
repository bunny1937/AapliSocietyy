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
  database: { label: "set here", fg: "var(--success)", bg: "var(--success-bg)" },
  environment: { label: "from env", fg: "var(--warning)", bg: "var(--warning-bg)" },
  default: { label: "default", fg: "var(--fg-4)", bg: "var(--bg-muted)" },
};

const slug = (g) => g.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function get(url) {
  const res = await fetch(url, { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load");
  return res.json();
}

const card = {
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "18px 20px",
  marginBottom: 20,
  background: "var(--bg-surface)",
};
const btn = (bg = "var(--bg-surface)", fg = "var(--fg-1)") => ({
  background: bg,
  color: fg,
  border: "1px solid var(--border-strong)",
  borderRadius: 7,
  fontSize: 12,
  fontWeight: 600,
  padding: "6px 12px",
  cursor: "pointer",
  fontFamily: "inherit",
});
const input = {
  border: "1px solid var(--border-strong)",
  borderRadius: 8,
  padding: "7px 10px",
  fontSize: 13,
  background: "var(--bg-input, var(--bg-surface))",
  color: "var(--fg-1)",
  width: "100%",
  maxWidth: 320,
  fontFamily: "inherit",
};

export default function PageClient() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [activeGroup, setActiveGroup] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["superadmin-settings"],
    queryFn: () => get("/api/superadmin/settings"),
  });

  // Search matches the label, the env var name AND the explanation, because
  // people look for a setting by what it does ("grace", "purge", "trial")
  // far more often than by whatever it ended up being called.
  const groups = useMemo(() => {
    if (!data?.settings) return [];
    const needle = query.trim().toLowerCase();
    const map = new Map();
    for (const s of data.settings) {
      if (
        needle &&
        ![s.label, s.env, s.key, s.why, s.group]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle))
      ) {
        continue;
      }
      if (!map.has(s.group)) map.set(s.group, []);
      map.get(s.group).push(s);
    }
    return [...map.entries()];
  }, [data, query]);

  const counts = useMemo(() => {
    const all = data?.settings || [];
    return {
      total: all.length,
      here: all.filter((s) => s.source === "database").length,
      env: all.filter((s) => s.source === "environment").length,
      guarded: all.filter((s) => s.reasonRequired).length,
    };
  }, [data]);

  // Searching shows every matching group at once — that IS the result set.
  // Otherwise the pane shows exactly one category.
  const shown = useMemo(() => {
    if (query.trim()) return groups;
    const picked = groups.find(([g]) => g === activeGroup);
    return picked ? [picked] : groups.slice(0, 1);
  }, [groups, activeGroup, query]);

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
      <div style={{ padding: 40, color: "var(--danger)" }}>
        Could not load settings: {error.message}
      </div>
    );

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", color: "var(--fg-2)" }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, margin: "0 0 4px", color: "var(--fg-1)" }}>Platform settings</h1>
      <p style={{ color: "var(--fg-3)", fontSize: 13, margin: "0 0 18px", maxWidth: 760, lineHeight: 1.6 }}>
        These take effect within a minute of saving, on every server, with no redeploy. A value set
        here overrides its environment variable; resetting falls back through the environment
        variable to the code default, so a setting can never end up unset.
      </p>

      {/* Where every value is coming from, before you change any of them. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 11, marginBottom: 16 }}>
        {[
          { label: "Settings", value: counts.total, sub: "editable here", tone: "var(--fg-1)" },
          { label: "Set here", value: counts.here, sub: "overriding env", tone: "var(--success)" },
          { label: "From env", value: counts.env, sub: "deploy-controlled", tone: "var(--warning)" },
          { label: "Need a reason", value: counts.guarded, sub: "guarded changes", tone: "var(--danger)" },
        ].map((c) => (
          <div key={c.label} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ fontSize: 10, color: "var(--fg-3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>{c.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: c.tone, marginTop: 4, lineHeight: 1.1 }}>{c.value}</div>
            <div style={{ fontSize: 10.5, color: "var(--fg-4)", marginTop: 3 }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Search + jump. Forty-odd settings down one page is a scroll hunt;
          these two turn it into a lookup. */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search settings — name, env var, or what it does…"
          style={{ ...input, maxWidth: 420, flex: 1, minWidth: 240 }}
        />
        {query && <button style={btn()} onClick={() => setQuery("")}>Clear</button>}
      </div>

      {/* Two panes, not one scroll.
          Forty-odd settings stacked down a single page meant the only way to
          reach the last group was to scroll past every group before it, and
          nothing on screen told you how many more there were. The rail is the
          whole map; the pane is only what you picked. */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(200px, 250px) 1fr", gap: 14, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 8, position: "sticky", top: 8 }}>
          {groups.map(([group, rows]) => {
            const active = group === activeGroup;
            const edited = rows.filter((r) => r.key in draft).length;
            const fromEnv = rows.filter((r) => r.source === "environment").length;
            const guarded = rows.filter((r) => r.reasonRequired).length;
            return (
              <button
                key={group}
                onClick={() => setActiveGroup(group)}
                style={{
                  textAlign: "left", cursor: "pointer", fontFamily: "inherit",
                  background: active ? "var(--bg-surface)" : "transparent",
                  border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`,
                  borderLeft: `3px solid ${active ? "var(--primary)" : "transparent"}`,
                  borderRadius: 11, padding: "11px 13px", display: "grid", gap: 5,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: active ? "var(--fg-1)" : "var(--fg-2)" }}>{group}</span>
                  <span style={{ fontSize: 11, color: "var(--fg-4)" }}>{rows.length}</span>
                </div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {edited > 0 && <Tag tone="primary">{edited} edited</Tag>}
                  {fromEnv > 0 && <Tag tone="warning">{fromEnv} from env</Tag>}
                  {guarded > 0 && <Tag tone="danger">{guarded} guarded</Tag>}
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          {shown.map(([group, rows]) => (
            <div key={group} id={slug(group)} style={{ ...card, marginBottom: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "var(--fg-1)" }}>{group}</h2>
                <span style={{ fontSize: 11, color: "var(--fg-4)" }}>{rows.length} setting{rows.length === 1 ? "" : "s"}</span>
              </div>
              {rows.map((s) => (
                <SettingRow key={s.key} s={s} draft={draft} edit={edit} reset={reset} />
              ))}
            </div>
          ))}
        </div>
      </div>

      <p style={{ fontSize: "0.75rem", color: "var(--fg-3)", lineHeight: 1.7 }}>
        Not editable here on purpose: <code>CRON_SECRET</code>, <code>JWT_SECRET</code>,{" "}
        <code>MONGODB_URI</code>, the Brevo and Redis credentials. A secret that can be read back out
        of a web page is not a secret, and one that can be changed from a web page can lock every
        server out of the database from a single mistyped field.
      </p>
    </div>
  );
}

/**
 * One setting. Lifted out of the page so the layout above can put settings
 * wherever it likes — a category pane, a search result list — without the row
 * itself changing.
 */
function SettingRow({ s, draft, edit, reset }) {
  const current = s.key in draft ? draft[s.key] : s.value;
  const changed = s.key in draft;
  const src = SOURCE[s.source] || SOURCE.default;
  return (
    <div
      key={s.key}
      style={{
        padding: "14px 0",
        borderTop: "1px solid var(--border)",
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
            <span style={{ color: "var(--warning)", fontSize: "0.62rem", marginLeft: 6 }}>
              NEEDS A REASON
            </span>
          )}
        </div>
        <div style={{ color: "var(--fg-3)", fontSize: "0.72rem", marginTop: 3 }}>
          <code>{s.env}</code>{" "}
          <span style={{
            background: src.bg, color: src.fg, borderRadius: 999,
            padding: "1px 7px", fontSize: 10, fontWeight: 700,
            textTransform: "uppercase", letterSpacing: "0.4px",
          }}>{src.label}</span>
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
            color: "var(--fg-3)",
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

        <div style={{ marginTop: 6, fontSize: "0.7rem", color: "var(--fg-3)" }}>
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
          <div style={{ marginTop: 6, fontSize: "0.72rem", color: "var(--warning)" }}>
            was {Array.isArray(s.value) ? s.value.join(", ") || "empty" : String(s.value)}
          </div>
        )}
      </div>
    </div>
  );
}

/** Small count badge used on the category rail. */
function Tag({ tone, children }) {
  const tones = {
    primary: ["var(--primary)", "var(--accent-tint)"],
    warning: ["var(--warning)", "var(--warning-bg)"],
    danger: ["var(--danger)", "var(--danger-bg)"],
  };
  const [fg, bg] = tones[tone] || tones.primary;
  return (
    <span
      style={{
        background: bg,
        color: fg,
        borderRadius: 999,
        padding: "1px 7px",
        fontSize: 9.5,
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: "0.4px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

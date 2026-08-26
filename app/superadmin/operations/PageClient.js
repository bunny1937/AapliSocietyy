"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import notify from "@/lib/notify";

// The operations dashboard.
//
// ## What it is for
//
// Everything on this page fails by going quiet. A cron that was never
// registered raises nothing. A purge that skips every candidate reports a
// successful run. A society knocking on a module it has not bought gets a 404
// that nobody sees. None of it appears in a log, because the absence of an
// event writes no line.
//
// So this page shows the *absence*: what should have happened and did not, and
// what is waiting on something.
//
// ## One rule for the whole page
//
// Every row says what is broken in words, not a status code. "society-purge:
// stale" tells an operator nothing at 2am. "Soft-deleted societies are not
// being erased" is a sentence they can act on. That is why the registry carries
// a `blocks` string and every queue row carries a `why`.

const TONE = {
  ok: { fg: "var(--success-fg, #15803d)", bg: "var(--success-bg, #f0fdf4)", label: "Healthy" },
  late: { fg: "#b45309", bg: "#fffbeb", label: "Running late" },
  degraded: { fg: "#b45309", bg: "#fffbeb", label: "Degraded" },
  critical: { fg: "var(--danger-fg, #b91c1c)", bg: "#fef2f2", label: "Something has stopped" },
};

const STATE_TONE = {
  ok: TONE.ok,
  late: TONE.late,
  stale: TONE.critical,
  failing: TONE.critical,
  "never-run": TONE.critical,
};

const STATE_LABEL = {
  ok: "ok",
  late: "late",
  stale: "STALE",
  failing: "FAILING",
  "never-run": "NEVER RUN",
};

async function get(url) {
  const res = await fetch(url, { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load");
  return res.json();
}

function ago(date) {
  if (!date) return "never";
  const ms = Date.now() - new Date(date).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const card = {
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: 10,
  padding: "18px 20px",
  marginBottom: 20,
  background: "var(--bg-1, #fff)",
};
const th = {
  padding: "8px 10px",
  textAlign: "left",
  fontSize: "0.7rem",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--fg-2, #6b7280)",
  borderBottom: "1px solid var(--border, #e5e7eb)",
};
const td = {
  padding: "10px",
  fontSize: "0.82rem",
  borderBottom: "1px solid var(--border-subtle, #f1f5f9)",
  verticalAlign: "top",
};
const btn = (bg = "var(--fg-3, #f3f4f6)", fg = "inherit") => ({
  background: bg,
  color: fg,
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: 5,
  fontSize: "0.72rem",
  padding: "4px 10px",
  cursor: "pointer",
});

export default function PageClient() {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [showSetup, setShowSetup] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["superadmin-operations"],
    queryFn: () => get("/api/superadmin/operations"),
    // Health is derived on read, so refetching is the whole mechanism by which
    // this page notices a job has gone quiet.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  async function runJob(key, dryRun) {
    if (!dryRun) {
      const ok = await notify.confirm(
        `Run "${key}" for real, right now? This is the same request the scheduler makes — it will send emails and change data.`,
        { tone: "danger" },
      );
      if (!ok) return;
    }
    setRunning(`${key}:${dryRun}`);
    setLastResult(null);
    try {
      const res = await fetch("/api/superadmin/operations/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ job: key, dryRun }),
      });
      const body = await res.json();
      if (!res.ok) {
        notify.error(body.error || "Run failed");
        return;
      }
      setLastResult({ key, dryRun, ...body });
      if (body.ok) notify.success(`${key} ${dryRun ? "dry run" : "run"} finished`);
      else notify.error(`${key} answered ${body.status}`);
      queryClient.invalidateQueries(["superadmin-operations"]);
    } catch (err) {
      notify.error(err.message || "Run failed");
    } finally {
      setRunning(null);
    }
  }

  if (isLoading) return <div style={{ padding: 40, color: "var(--fg-2)" }}>Loading operations…</div>;
  if (error)
    return (
      <div style={{ padding: 40, color: "var(--danger-fg, #b91c1c)" }}>
        Could not load operations: {error.message}
      </div>
    );

  const { crons, config, queues, recentRuns, generatedAt } = data;
  const tone = TONE[crons.overall] || TONE.ok;
  const neverRun = crons.jobs.filter((j) => j.state === "never-run");

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1180 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <h1 style={{ fontSize: "1.35rem", margin: 0 }}>Operations</h1>
        <span style={{ fontSize: "0.72rem", color: "var(--fg-2, #6b7280)" }}>
          checked {ago(generatedAt)} · refreshes every minute
        </span>
      </div>
      <p style={{ color: "var(--fg-2, #6b7280)", fontSize: "0.82rem", margin: "0 0 20px", maxWidth: 720 }}>
        Everything here fails by going quiet rather than by raising an error. This page shows what
        should have happened and did not.
      </p>

      {/* ── overall banner ────────────────────────────────────────────── */}
      <div
        style={{
          ...card,
          background: tone.bg,
          borderColor: tone.fg,
          borderLeft: `3px solid ${tone.fg}`,
        }}
      >
        <div style={{ fontWeight: 700, color: tone.fg, fontSize: "0.95rem" }}>{tone.label}</div>
        <div style={{ fontSize: "0.82rem", marginTop: 4, lineHeight: 1.6 }}>
          {crons.overall === "ok"
            ? "Every scheduled job has run inside its window."
            : neverRun.length
              ? `${neverRun.length} job(s) have never run once — almost always a job that was never registered on cron-job.org.`
              : "One or more jobs are late, stale or failing. The table below says what each one stops."}
        </div>
      </div>

      {/* ── crons ─────────────────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontSize: "1rem", margin: 0 }}>Scheduled jobs</h2>
          <button style={btn()} onClick={() => setShowSetup((v) => !v)}>
            {showSetup ? "Hide" : "Show"} cron-job.org setup
          </button>
        </div>

        {showSetup && (
          <pre
            style={{
              background: "var(--bg-2, #f8fafc)",
              padding: 12,
              borderRadius: 6,
              fontSize: "0.72rem",
              overflowX: "auto",
              marginBottom: 16,
            }}
          >
            {crons.setup.map((s) => s.line).join("\n")}
          </pre>
        )}

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Job</th>
                <th style={th}>State</th>
                <th style={th}>Last real run</th>
                <th style={th}>Cadence</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {crons.jobs.map((job) => {
                const t = STATE_TONE[job.state] || TONE.ok;
                const bad = ["stale", "failing", "never-run"].includes(job.state);
                return (
                  <tr key={job.key}>
                    <td style={td}>
                      <strong>{job.label}</strong>
                      {job.critical && (
                        <span style={{ color: "var(--danger-fg, #b91c1c)", fontSize: "0.62rem", marginLeft: 6 }}>
                          CRITICAL
                        </span>
                      )}
                      <div style={{ color: "var(--fg-2, #6b7280)", fontSize: "0.72rem", marginTop: 3 }}>
                        <code>{job.path}</code>
                      </div>
                      {/* Shown only when it matters — a healthy job does not
                          need to explain what would break if it stopped. */}
                      {bad && (
                        <div
                          style={{
                            marginTop: 6,
                            fontSize: "0.75rem",
                            lineHeight: 1.55,
                            color: "var(--danger-fg, #b91c1c)",
                          }}
                        >
                          {job.blocks}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <span style={{ color: t.fg, fontWeight: bad ? 700 : 500, fontSize: "0.75rem" }}>
                        {STATE_LABEL[job.state]}
                      </span>
                      {job.state === "failing" && job.lastRun?.error && (
                        <div style={{ fontSize: "0.68rem", color: "var(--fg-2)", marginTop: 4, maxWidth: 220 }}>
                          {job.lastRun.error.slice(0, 120)}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      {ago(job.lastRunAt)}
                      {job.lastRun?.summary && Object.keys(job.lastRun.summary).length > 0 && (
                        <div style={{ fontSize: "0.68rem", color: "var(--fg-2)", marginTop: 4 }}>
                          {Object.entries(job.lastRun.summary)
                            .slice(0, 4)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(" · ")}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap", fontSize: "0.75rem" }}>{job.cadence}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <button
                        style={btn()}
                        disabled={running === `${job.key}:true`}
                        onClick={() => runJob(job.key, true)}
                      >
                        {running === `${job.key}:true` ? "…" : "Dry run"}
                      </button>{" "}
                      <button
                        style={btn("var(--danger-fg, #b91c1c)", "#fff")}
                        disabled={running === `${job.key}:false`}
                        onClick={() => runJob(job.key, false)}
                      >
                        {running === `${job.key}:false` ? "…" : "Run now"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p style={{ fontSize: "0.72rem", color: "var(--fg-2, #6b7280)", marginTop: 12, lineHeight: 1.6 }}>
          A dry run deliberately does <strong>not</strong> count as the job having run. Otherwise
          pressing the button would reset the clock and hide a dead schedule for another full
          interval — a monitor you can silence by looking at it.
        </p>

        {lastResult && (
          <details open style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontSize: "0.8rem" }}>
              {lastResult.key} — {lastResult.dryRun ? "dry run" : "live run"} · HTTP {lastResult.status} ·{" "}
              {lastResult.tookMs}ms
            </summary>
            <pre
              style={{
                background: "var(--bg-2, #f8fafc)",
                padding: 12,
                borderRadius: 6,
                fontSize: "0.7rem",
                overflowX: "auto",
                maxHeight: 320,
                marginTop: 8,
              }}
            >
              {JSON.stringify(lastResult.result, null, 2)}
            </pre>
          </details>
        )}
      </div>

      {/* ── configuration ─────────────────────────────────────────────── */}
      <div style={card}>
        <h2 style={{ fontSize: "1rem", margin: "0 0 4px" }}>Configuration</h2>
        <p style={{ color: "var(--fg-2, #6b7280)", fontSize: "0.78rem", margin: "0 0 12px" }}>
          Settings whose absence produces silence rather than an error.
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {config.map((c) => (
              <tr key={c.key}>
                <td style={{ ...td, whiteSpace: "nowrap", width: 1 }}>
                  <code style={{ fontSize: "0.75rem" }}>{c.key}</code>
                </td>
                <td style={{ ...td, whiteSpace: "nowrap", width: 1 }}>
                  <span
                    style={{
                      color: c.ok
                        ? "var(--success-fg, #15803d)"
                        : c.severity === "critical"
                          ? "var(--danger-fg, #b91c1c)"
                          : "#b45309",
                      fontWeight: 600,
                      fontSize: "0.75rem",
                    }}
                  >
                    {c.value || "not set"}
                  </span>
                </td>
                <td style={{ ...td, color: "var(--fg-2, #6b7280)", fontSize: "0.75rem", lineHeight: 1.55 }}>
                  {c.why}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── purge queue ───────────────────────────────────────────────── */}
      <Queue
        title="Societies waiting to be erased"
        subtitle="A green purge cron does not mean anything is coming out of it. These are soft-deleted societies and the gate blocking each one."
        count={`${queues.purge.blocked} blocked · ${queues.purge.ready} ready · ${queues.purge.waiting} waiting`}
        empty="No societies are soft-deleted."
        rows={queues.purge.rows}
        render={(r) => (
          <tr key={r.societyId}>
            <td style={td}>
              <strong>{r.name}</strong>
              {r.waived && (
                <span style={{ fontSize: "0.62rem", color: "#b45309", marginLeft: 6 }}>WAIVED</span>
              )}
              <div style={{ color: "var(--fg-2)", fontSize: "0.7rem", marginTop: 2 }}>{r.code || r.societyId}</div>
            </td>
            <td style={{ ...td, whiteSpace: "nowrap" }}>
              <span
                style={{
                  color:
                    r.state === "blocked"
                      ? "var(--danger-fg, #b91c1c)"
                      : r.state === "ready"
                        ? "var(--success-fg, #15803d)"
                        : "var(--fg-2)",
                  fontWeight: 600,
                  fontSize: "0.75rem",
                }}
              >
                {r.state}
              </span>
              {r.overdueDays > 0 && (
                <div style={{ fontSize: "0.68rem", color: "var(--fg-2)", marginTop: 3 }}>
                  {r.overdueDays}d past its date
                </div>
              )}
            </td>
            <td style={td}>
              {r.blockers.length === 0 ? (
                <span style={{ color: "var(--success-fg, #15803d)", fontSize: "0.78rem" }}>
                  All six gates satisfied — the next purge run will erase this.
                </span>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: "0.78rem", lineHeight: 1.6 }}>
                  {r.blockers.map((b, i) => (
                    <li key={i} style={{ color: b.waiting ? "var(--fg-2)" : "inherit" }}>
                      <strong>Gate {b.gate}:</strong> {b.why}
                    </li>
                  ))}
                </ul>
              )}
            </td>
          </tr>
        )}
        head={["Society", "State", "What is blocking it"]}
      />

      {/* ── handover queue ────────────────────────────────────────────── */}
      <Queue
        title="Handovers not yet collected"
        subtitle="Purge gate 6 keys on a society actually downloading its records — never on the email having been sent. These are the ones still being chased."
        count={
          queues.handovers.unreachable
            ? `${queues.handovers.unreachable} with no address on file`
            : `${queues.handovers.rows.length} outstanding`
        }
        empty="Every handover has been collected."
        rows={queues.handovers.rows}
        head={["Society", "Sent to", "Reminders", "Age"]}
        render={(h) => (
          <tr key={h.handoverId}>
            <td style={td}>
              <strong>{h.societyName}</strong>
              <div style={{ color: "var(--fg-2)", fontSize: "0.7rem", marginTop: 2 }}>{h.status}</div>
            </td>
            <td style={td}>
              {h.unreachable ? (
                <span style={{ color: "var(--danger-fg, #b91c1c)", fontSize: "0.78rem" }}>
                  No address on file — reminders cannot reach anybody. Resend the handover from the
                  delete wizard and enter an address when it asks.
                </span>
              ) : (
                <span style={{ fontSize: "0.78rem" }}>{h.recipients.join(", ")}</span>
              )}
              {h.notifyError && (
                <div style={{ color: "var(--danger-fg, #b91c1c)", fontSize: "0.7rem", marginTop: 4 }}>
                  {h.notifyError}
                </div>
              )}
            </td>
            <td style={{ ...td, whiteSpace: "nowrap" }}>
              {h.reminderCount || 0}
              {h.reminderCount >= 6 && (
                <div style={{ fontSize: "0.68rem", color: "#b45309", marginTop: 3 }}>
                  chasing exhausted — needs a waiver
                </div>
              )}
              <div style={{ fontSize: "0.68rem", color: "var(--fg-2)", marginTop: 3 }}>
                last {ago(h.lastRemindedAt)}
              </div>
            </td>
            <td style={{ ...td, whiteSpace: "nowrap" }}>{h.ageDays}d</td>
          </tr>
        )}
      />

      {/* ── subscription queue ────────────────────────────────────────── */}
      <Queue
        title="Lapsed subscriptions"
        subtitle="Derived from payment dates on read, so this is correct whether or not the lifecycle cron has run."
        count={`${queues.subscriptions.rows.length} society(s)`}
        empty="Every society is in trial or paid up."
        rows={queues.subscriptions.rows}
        head={["Society", "State", "Days", "Contact"]}
        render={(s) => (
          <tr key={s.societyId}>
            <td style={td}>
              <strong>{s.name}</strong>
            </td>
            <td style={{ ...td, whiteSpace: "nowrap" }}>
              <span
                style={{
                  color: s.state === "blocked" ? "var(--danger-fg, #b91c1c)" : "#b45309",
                  fontWeight: 600,
                  fontSize: "0.75rem",
                }}
              >
                {s.state}
              </span>
            </td>
            <td style={{ ...td, whiteSpace: "nowrap" }}>{s.daysInState}</td>
            <td style={td}>
              {s.contact || <span style={{ color: "var(--danger-fg, #b91c1c)" }}>no address on file</span>}
            </td>
          </tr>
        )}
      />

      {/* ── denials ───────────────────────────────────────────────────── */}
      <Queue
        title="Module denials, last 7 days"
        subtitle="Societies opening doors they have not bought. This is a sales list, not a security list."
        count={`${queues.denials.rows.length} society(s)`}
        empty="Nobody has hit a locked module this week."
        rows={queues.denials.rows}
        head={["Society", "Attempts", "Modules", "Last"]}
        render={(d) => (
          <tr key={d.societyId}>
            <td style={td}>
              <strong>{d.societyName}</strong>
              {d.surfaces.includes("app") && (
                <div style={{ fontSize: "0.68rem", color: "var(--fg-2)", marginTop: 3 }}>
                  includes mobile app — may be an old build rather than interest
                </div>
              )}
            </td>
            <td style={{ ...td, whiteSpace: "nowrap" }}>{d.denials}</td>
            <td style={td}>{d.modules.join(", ")}</td>
            <td style={{ ...td, whiteSpace: "nowrap" }}>{ago(d.lastAt)}</td>
          </tr>
        )}
      />

      {/* ── recent runs ───────────────────────────────────────────────── */}
      <div style={card}>
        <h2 style={{ fontSize: "1rem", margin: "0 0 12px" }}>Recent runs</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Job</th>
                <th style={th}>When</th>
                <th style={th}>Result</th>
                <th style={th}>Took</th>
                <th style={th}>Trigger</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((r) => (
                <tr key={r._id}>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{r.job}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{ago(r.startedAt)}</td>
                  <td style={td}>
                    <span
                      style={{
                        color: r.ok ? "var(--success-fg, #15803d)" : "var(--danger-fg, #b91c1c)",
                        fontWeight: 600,
                        fontSize: "0.75rem",
                      }}
                    >
                      {r.ok ? "ok" : "failed"}
                    </span>
                    {r.dryRun && (
                      <span style={{ fontSize: "0.62rem", color: "var(--fg-2)", marginLeft: 6 }}>DRY</span>
                    )}
                    {r.error && (
                      <div style={{ fontSize: "0.68rem", color: "var(--danger-fg)", marginTop: 4 }}>
                        {r.error.slice(0, 160)}
                      </div>
                    )}
                    {r.summary && Object.keys(r.summary).length > 0 && (
                      <div style={{ fontSize: "0.68rem", color: "var(--fg-2)", marginTop: 4 }}>
                        {Object.entries(r.summary)
                          .slice(0, 5)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(" · ")}
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{r.tookMs ? `${r.tookMs}ms` : "—"}</td>
                  <td style={{ ...td, whiteSpace: "nowrap", fontSize: "0.72rem" }}>{r.trigger}</td>
                </tr>
              ))}
              {recentRuns.length === 0 && (
                <tr>
                  <td style={{ ...td, color: "var(--fg-2)" }} colSpan={5}>
                    No run has ever been recorded. If the jobs are registered, they are not reaching
                    this deployment — check <code>CRON_SECRET</code> matches on both sides.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Queue({ title, subtitle, count, empty, rows, head, render }) {
  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <h2 style={{ fontSize: "1rem", margin: 0 }}>{title}</h2>
        <span style={{ fontSize: "0.72rem", color: "var(--fg-2, #6b7280)" }}>{count}</span>
      </div>
      <p style={{ color: "var(--fg-2, #6b7280)", fontSize: "0.78rem", margin: "0 0 12px", maxWidth: 760 }}>
        {subtitle}
      </p>
      {rows.length === 0 ? (
        <div style={{ color: "var(--fg-2, #6b7280)", fontSize: "0.82rem", padding: "8px 0" }}>{empty}</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {head.map((h) => (
                  <th key={h} style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{rows.map(render)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

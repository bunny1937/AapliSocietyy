"use client";

// app/superadmin/societies/BulkImportWizard.jsx
//
// Upload the filled template → preview validates everything (every sheet,
// every DB check — society name taken, admin/member emails already
// registered) and shows every row's status before anything is created →
// Import commits using that same reviewed result, never re-checking what
// preview already confirmed.
//
// This used to also offer a native in-browser paste-grid as a second way to
// enter the same data, sheet by sheet. Removed: every real use of this tool
// starts from a spreadsheet that already has the data, so the grid was a
// second path to the same result nobody needed. If a future need for
// hand-typing a society with no spreadsheet at all shows up, rebuild it
// then — don't resurrect this from history speculatively.

import { useCallback, useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import {
  ClipboardPaste,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  X,
  Download,
} from "lucide-react";
import styles from "@/styles/BulkImportWizard.module.css";
import notify from "@/lib/notify";

const ROW_COLOR = {
  ok: "var(--success)",
  warning: "var(--warning)",
  error: "var(--danger)",
};
const ROW_BG = {
  ok: "rgba(16, 185, 129, 0.08)",
  warning: "rgba(245, 158, 11, 0.1)",
  error: "rgba(239, 68, 68, 0.1)",
};

export default function BulkImportWizard({ open, onClose, onImported, BillHistoryStep }) {
  // idle | previewing | reviewing | importing
  const [stage, setStage] = useState("idle");
  const [previewResult, setPreviewResult] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [revealedCount, setRevealedCount] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [serverResult, setServerResult] = useState(null);
  const [progress, setProgress] = useState(null);
  const [showBillHistory, setShowBillHistory] = useState(false);
  const [billHistoryDone, setBillHistoryDone] = useState(false);
  const shellRef = useRef(null);
  const scrimRef = useRef(null);
  const fileInputRef = useRef(null);

  // ── Entrance morph ─────────────────────────────────────────────────────
  // transform + opacity only.
  useEffect(() => {
    if (!open || !shellRef.current) return;
    const shell = shellRef.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      gsap.set(shell, { opacity: 1, scale: 1, y: 0 });
      return;
    }
    const tl = gsap.timeline();
    gsap.set(scrimRef.current, { opacity: 0 });
    gsap.set(shell, { opacity: 0, scaleX: 0.86, scaleY: 0.6, y: 28 });
    tl.to(scrimRef.current, { opacity: 1, duration: 0.18, ease: "none" }, 0)
      .to(shell, { opacity: 1, duration: 0.14, ease: "none" }, 0)
      .to(shell, { scaleX: 1, duration: 0.42, ease: "power3.out" }, 0)
      .to(shell, { scaleY: 1, y: 0, duration: 0.5, ease: "back.out(1.2)" }, 0.12)
      .to(
        shell.querySelectorAll("[data-stagger]"),
        { opacity: 1, y: 0, duration: 0.3, ease: "power2.out", stagger: { amount: 0.2 } },
        0.3,
      )
      .set(shell, { clearProps: "transform" });
    return () => tl.kill();
  }, [open]);

  // ── Preview: parses + runs every check (including DB reads), writes
  //    nothing. Every row's status comes back at once; the "live" feel
  //    below is a staged reveal of an already-complete result, not a
  //    server that's still checking — nothing here is hidden or delayed
  //    on the server side.
  const previewFile = useCallback(async (file) => {
    setStage("previewing");
    setPreviewError(null);
    setPreviewResult(null);
    setRevealedCount(0);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/admin/bulk-import/preview", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok && json.fatalError) {
        setPreviewError(json.fatalError);
        setStage("idle");
        return;
      }
      setPreviewResult(json);
      setStage("reviewing");
    } catch (err) {
      setPreviewError(err.message || "Could not reach the server.");
      setStage("idle");
    }
  }, []);

  // Staged reveal of the (already complete) preview result — total time is
  // constant regardless of row count, never so fast a small sheet just
  // flashes, never so slow a big one drags.
  useEffect(() => {
    if (stage !== "reviewing" || !previewResult) return;
    const total = previewResult.memberRows?.length || 0;
    setRevealedCount(0);
    if (total === 0) return;
    let i = 0;
    const stepMs = Math.max(12, Math.min(70, 1100 / total));
    const id = setInterval(() => {
      i += 1;
      setRevealedCount(i);
      if (i >= total) clearInterval(id);
    }, stepMs);
    return () => clearInterval(id);
  }, [stage, previewResult]);

  const revealDone = !previewResult || revealedCount >= (previewResult.memberRows?.length || 0);

  // ── Commit: uses the previewId the reviewed result already carries.
  //    Never re-uploads the file, never re-runs a DB check — everything
  //    here was already confirmed by preview. A retry after a mid-import
  //    failure calls this again with the SAME previewId (new importRunId,
  //    so the run itself isn't treated as a duplicate) rather than sending
  //    the admin back to re-validate from scratch.
  const commitPreview = useCallback(async () => {
    if (!previewResult?.previewId || submitting) return;
    setSubmitting(true);
    setServerResult(null);
    setStage("importing");

    const runId = crypto.randomUUID();

    const poll = setInterval(async () => {
      try {
        const r = await fetch(
          `/api/admin/bulk-import/status?importRunId=${runId}`,
          { credentials: "include" },
        );
        if (r.ok) setProgress(await r.json());
      } catch { /* transient; next tick retries */ }
    }, 1200);

    try {
      const formData = new FormData();
      formData.append("previewId", previewResult.previewId);
      formData.append("importRunId", runId);
      const res = await fetch("/api/admin/bulk-import", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const json = await res.json();
      setServerResult({ ok: res.ok, ...json });
      if (res.ok && json.success) onImported?.(json);
    } catch (err) {
      setServerResult({ ok: false, error: err.message });
    } finally {
      clearInterval(poll);
      setSubmitting(false);
    }
  }, [previewResult, submitting, onImported]);

  const downloadTemplate = useCallback(async () => {
    const res = await fetch("/api/admin/bulk-import/template", { credentials: "include" });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = "BulkImport_Template.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const reset = useCallback(() => {
    setStage("idle");
    setPreviewResult(null);
    setPreviewError(null);
    setServerResult(null);
    setRevealedCount(0);
  }, []);

  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (e.key === "Escape" && !submitting) onClose?.();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, submitting, onClose]);

  const summary = previewResult?.summary || { total: 0, ok: 0, warning: 0, error: 0 };
  const societyHasErrors = (previewResult?.society?.errors?.length || 0) > 0;
  const canImport =
    stage === "reviewing" && revealDone && previewResult?.ok && !societyHasErrors;

  if (!open) return null;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div ref={scrimRef} className={styles.scrim} onClick={() => !submitting && onClose?.()} />

      <div ref={shellRef} className={styles.shell}>
        {/* Header */}
        <header className={styles.header} data-stagger>
          <div>
            <h2 className={styles.title}>Import a society</h2>
            <p className={styles.subtitle}>
              Download the template, fill all 7 sheets in Excel, upload it back here. Every check
              — including the database ones — runs before anything is created, and you see every
              row's result before you commit to it.
            </p>
          </div>
          {stage === "idle" && !submitting && (
            <div className={styles.sheetActions}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = ""; // allow re-selecting the same file after a fix
                  if (f) previewFile(f);
                }}
              />
              <button className={styles.ghostBtn} onClick={downloadTemplate}>
                <Download size={14} /> Download template
              </button>
              <button
                className={styles.ghostBtn}
                onClick={() => fileInputRef.current?.click()}
              >
                <ClipboardPaste size={14} /> Upload filled Excel (.xlsx)
              </button>
            </div>
          )}
          {stage === "reviewing" && !submitting && (
            <div className={styles.sheetActions}>
              <button className={styles.ghostBtn} onClick={reset}>
                Try a different file
              </button>
            </div>
          )}
          <button className={styles.iconBtn} onClick={onClose} disabled={submitting} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className={styles.body} data-stagger>
          {stage === "idle" && !serverResult && (
            <div className={styles.centerState}>
              {previewError ? (
                <>
                  <AlertTriangle size={22} className={styles.errIcon} />
                  <p>{previewError}</p>
                </>
              ) : (
                <p>
                  No file uploaded yet. Download the template above if you don't have one, fill it
                  in Excel, then use Upload — you'll see a full review before anything is created.
                </p>
              )}
            </div>
          )}

          {stage === "previewing" && (
            <div className={styles.centerState}>
              <Loader2 className={styles.spin} size={22} />
              <p>Checking every sheet — society details, all flats, every email against the database…</p>
            </div>
          )}

          {stage === "reviewing" && previewResult && (
            <div style={{ padding: "0.25rem 0.5rem" }}>
              {/* Society */}
              <div
                style={{
                  border: `1.5px solid ${societyHasErrors ? "var(--danger)" : "var(--success)"}`,
                  background: societyHasErrors ? ROW_BG.error : ROW_BG.ok,
                  borderRadius: 10,
                  padding: "1rem 1.1rem",
                  marginBottom: 14,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 13.5, color: "var(--fg-2)", marginBottom: 6 }}>
                  {societyHasErrors ? <AlertTriangle size={15} color={ROW_COLOR.error} /> : <CheckCircle2 size={15} color={ROW_COLOR.ok} />}
                  Society — {previewResult.society?.name || "(unnamed)"}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--fg-3)" }}>
                  Admin: {previewResult.society?.adminName} · {previewResult.society?.adminEmail}
                </div>
                {previewResult.society?.errors?.map((e, i) => (
                  <div key={i} style={{ fontSize: 12, color: "var(--danger)", marginTop: 4 }}>✕ {e}</div>
                ))}
                {previewResult.society?.advisories?.map((a, i) => (
                  <div key={i} style={{ fontSize: 12, color: "var(--warning)", marginTop: 4 }}>⚠ {a}</div>
                ))}
              </div>

              {previewResult.warnings?.length > 0 && (
                <div style={{ background: "var(--warning)", borderRadius: 8, padding: "0.75rem 1rem", marginBottom: 14 }}>
                  {previewResult.warnings.map((w, i) => (
                    <div key={i} style={{ fontSize: 12, color: "var(--warning)" }}>⚠ {w}</div>
                  ))}
                </div>
              )}

              {/* Member rows — staged reveal, colored by status */}
              <div style={{ fontWeight: 700, fontSize: 13, color: "var(--accent)", marginBottom: 8 }}>
                Flats ({summary.total}) — {summary.ok} ready, {summary.warning} note{summary.warning === 1 ? "" : "s"}, {summary.error} need fixing
              </div>
              <div style={{ maxHeight: 340, overflowY: "auto", border: "1px solid var(--fg-2)", borderRadius: 10 }}>
                {(previewResult.memberRows || []).slice(0, revealedCount).map((r, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                      padding: "8px 12px",
                      borderLeft: `3px solid ${ROW_COLOR[r.status] || "var(--fg-4)"}`,
                      background: ROW_BG[r.status] || "transparent",
                      borderTop: i === 0 ? "none" : "1px solid var(--fg-2)",
                      animation: "bulkImportRowIn 0.22s ease both",
                    }}
                  >
                    {r.status === "ok" && <CheckCircle2 size={14} color={ROW_COLOR.ok} style={{ marginTop: 1, flexShrink: 0 }} />}
                    {r.status === "warning" && <AlertTriangle size={14} color={ROW_COLOR.warning} style={{ marginTop: 1, flexShrink: 0 }} />}
                    {r.status === "error" && <AlertTriangle size={14} color={ROW_COLOR.error} style={{ marginTop: 1, flexShrink: 0 }} />}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--fg-2)" }}>
                        {r.wing ? `${r.wing}-${r.flatNo}` : r.flatNo || `Row ${r.rowNum}`}
                      </span>
                      {r.ownerName && <span style={{ fontSize: 12, color: "var(--fg-5)" }}> · {r.ownerName}</span>}
                      {r.messages?.length > 0 && (
                        <div style={{ fontSize: 11.5, color: r.status === "error" ? "var(--danger)" : "var(--warning)", marginTop: 2 }}>
                          {r.messages.join("; ")}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {!revealDone && (
                  <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--fg-4)" }}>
                    checking… {revealedCount}/{summary.total}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
                {!canImport && revealDone && (
                  <span style={{ fontSize: 12, color: "var(--danger)" }}>
                    Fix the errors above (in Excel) and upload again to import.
                  </span>
                )}
                <button
                  onClick={commitPreview}
                  disabled={!canImport}
                  style={{
                    background: canImport ? "var(--accent)" : "var(--fg-3)",
                    color: "#fff",
                    border: "none",
                    padding: "0.6rem 1.4rem",
                    borderRadius: 8,
                    cursor: canImport ? "pointer" : "not-allowed",
                    fontWeight: 700,
                    fontSize: 13.5,
                  }}
                >
                  {revealDone ? `Import ${summary.ok + summary.warning} flat${summary.ok + summary.warning === 1 ? "" : "s"}` : "Checking…"}
                </button>
              </div>
            </div>
          )}

          {/* Live progress — real server stages, polled from BulkImportRun */}
          {stage === "importing" && (
            <div style={{ padding: "1.5rem 0.5rem" }}>
              <div style={{ marginBottom: "1.25rem", fontWeight: 600, color: "var(--accent)", fontSize: "0.9rem" }}>
                Importing {progress?.totalCount ? `${progress.processedCount ?? 0} / ${progress.totalCount} flats` : "…"}
              </div>
              {[
                { key: "VALIDATING", label: "Loading the reviewed preview", icon: "🔍" },
                { key: "IMPORTING", label: "Creating society, admin and flats", icon: "🏢" },
                { key: "FINALIZING", label: "Billing heads and current month bills", icon: "📋" },
                { key: "COMMITTED", label: "Committing the transaction", icon: "🔒" },
                { key: "EMAIL_QUEUED", label: "Queueing onboarding emails", icon: "✉️" },
                { key: "COMPLETED", label: "Done", icon: "✅" },
              ].map((s, i, arr) => {
                const now = arr.findIndex((x) => x.key === progress?.status);
                const done = now > i;
                const active = now === i;
                return (
                  <div key={s.key} style={{
                    display: "flex", alignItems: "center", gap: "0.75rem",
                    padding: "0.6rem 0.75rem", marginBottom: "0.5rem", borderRadius: 8,
                    background: done ? "var(--success)" : active ? "var(--primary)" : "var(--fg-2)",
                    border: `1px solid ${done ? "var(--success)" : active ? "var(--accent)" : "var(--fg-3)"}`,
                    opacity: done || active ? 1 : 0.45, transition: "all 0.3s ease",
                  }}>
                    <div style={{ fontSize: "1.1rem", minWidth: 24 }}>{done ? "✓" : s.icon}</div>
                    <div style={{ flex: 1, fontSize: "0.83rem", fontWeight: done || active ? 600 : 400,
                      color: done ? "var(--success)" : active ? "var(--accent)" : "var(--fg-4)" }}>
                      {progress?.stage && active ? progress.stage : s.label}
                    </div>
                    {active && <div style={{ fontSize: "0.7rem", color: "var(--accent)" }}>●●●</div>}
                    {done && <div style={{ fontSize: "0.75rem", color: "var(--success)", fontWeight: 700 }}>Done</div>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Commit rejection — retry reuses the same previewId, no re-check */}
          {serverResult && !serverResult.success && (
            <div className={styles.serverErr}>
              <AlertTriangle size={16} />
              <div>
                <strong>The import failed partway through.</strong>
                <ul>
                  {(serverResult.errors || [serverResult.error || "Unknown error"])
                    .slice(0, 12)
                    .map((e, i) => (
                      <li key={i}>{typeof e === "string" ? e : e.label}</li>
                    ))}
                </ul>
                {serverResult.code !== "PREVIEW_NOT_FOUND" && serverResult.code !== "PREVIEW_ALREADY_USED" && previewResult?.previewId && (
                  <button
                    onClick={commitPreview}
                    style={{ marginTop: 10, background: "var(--accent)", color: "#fff", border: "none", padding: "0.5rem 1rem", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 12.5 }}
                  >
                    Retry import (uses the same reviewed data — nothing re-checked)
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Success */}
          {serverResult?.success && (
            <div style={{ padding: "0.5rem" }}>
              <div style={{ background: "var(--success)", borderRadius: 8, padding: "1.25rem", marginBottom: "1rem" }}>
                <div style={{ color: "var(--success)", fontWeight: 700, fontSize: "1rem", marginBottom: "0.75rem" }}>
                  ✅ Import Successful
                </div>
                <div style={{ fontSize: "0.85rem", color: "var(--success)", lineHeight: 1.8 }}>
                  <div><strong>Society:</strong> {serverResult.society?.name} ({serverResult.society?.societyId})</div>
                  <div><strong>Members imported:</strong> {serverResult.membersCreated} / {serverResult.totalMemberRows}</div>
                  <div>
                    <strong>Billing heads:</strong>{" "}
                    {serverResult.billingHeadsCreated > 0
                      ? `${serverResult.billingHeadsCreated} heads created`
                      : <span style={{ color: "var(--warning)" }}>⚠ None — rates were 0</span>}
                  </div>
                  <div>
                    <strong>Bills generated:</strong>{" "}
                    {serverResult.billsGenerated > 0
                      ? `${serverResult.billsGenerated} bills for ${serverResult.billPeriod}`
                      : <span style={{ color: "var(--warning)" }}>⚠ 0</span>}
                  </div>
                  {serverResult.society?.chargesSummary?.length > 0 && (
                    <div style={{ marginTop: 4, paddingLeft: 8, borderLeft: "2px solid var(--success)" }}>
                      {serverResult.society.chargesSummary.map((c, i) => (
                        <div key={i} style={{ fontSize: "0.75rem", color: "var(--success)" }}>{c}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ background: "var(--primary)", borderRadius: 8, padding: "1.25rem", marginBottom: "1rem" }}>
                <div style={{ color: "var(--accent)", fontWeight: 700, marginBottom: "0.5rem" }}>Admin Credentials</div>
                <div style={{ fontSize: "0.85rem", color: "var(--primary-tint)", lineHeight: 1.8 }}>
                  <div><strong>Name:</strong> {serverResult.admin?.name}</div>
                  <div><strong>Email:</strong> {serverResult.admin?.email}</div>
                  {serverResult.admin?.reusedExistingAccount ? (
                    <div style={{ color: "var(--warning)", marginTop: 4 }}>
                      ⚠ {serverResult.admin.note || "This email already had a login — no new password was created. They sign in as before; this society now appears in their profile picker."}
                    </div>
                  ) : (
                    <div>
                      <strong>Password:</strong>{" "}
                      <code style={{ background: "var(--primary)", padding: "2px 6px", borderRadius: 4 }}>
                        {serverResult.admin?.password}
                      </code>
                      <span style={{ color: "var(--danger)", marginLeft: 8 }}>
                        Not emailed — copy this now, it isn't shown again.
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {serverResult.memberCredentials?.length > 0 && (
                <div style={{ background: "var(--primary)", borderRadius: 8, padding: "1.25rem", marginBottom: "1rem" }}>
                  <div style={{ color: "var(--accent)", fontWeight: 700, marginBottom: "0.5rem" }}>
                    Members ({serverResult.memberCredentials.length})
                  </div>
                  <div style={{ overflowX: "auto", maxHeight: 320 }}>
                    <table style={{ width: "100%", fontSize: "0.8rem", color: "var(--primary-tint)", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ textAlign: "left", color: "var(--accent)" }}>
                          <th style={{ padding: "4px 8px" }}>Flat</th>
                          <th style={{ padding: "4px 8px" }}>Name</th>
                          <th style={{ padding: "4px 8px" }}>Email</th>
                          <th style={{ padding: "4px 8px" }}>Account</th>
                          <th style={{ padding: "4px 8px" }}>Setup Link</th>
                        </tr>
                      </thead>
                      <tbody>
                        {serverResult.memberCredentials.map((c, i) => (
                          <tr key={i} style={{ borderTop: "1px solid var(--primary)" }}>
                            <td style={{ padding: "4px 8px" }}>{c.wing}-{c.flatNo}</td>
                            <td style={{ padding: "4px 8px" }}>{c.ownerName}</td>
                            <td style={{ padding: "4px 8px" }}>{c.email || <span style={{ color: "var(--fg-4)" }}>none</span>}</td>
                            <td style={{ padding: "4px 8px" }}>
                              {c.isNewUser
                                ? <span style={{ color: "var(--success)" }}>new login created</span>
                                : <span style={{ color: "var(--warning)" }}>existing account linked</span>}
                            </td>
                            <td style={{ padding: "4px 8px" }}>
                              {c.setCredentialsUrl ? (
                                <button
                                  onClick={() => navigator.clipboard.writeText(c.setCredentialsUrl)}
                                  style={{ background: "none", border: "none", color: "var(--accent)", textDecoration: "underline", cursor: "pointer", padding: 0, fontSize: "0.78rem" }}
                                >Copy link</button>
                              ) : <span style={{ color: "var(--fg-4)" }}>—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {serverResult.warnings?.length > 0 && (
                <div style={{ background: "var(--warning-bg)", borderRadius: 8, padding: "1rem", marginBottom: "1rem" }}>
                  <div style={{ color: "var(--warning-fg)", fontWeight: 600, marginBottom: "0.5rem" }}>
                    ⚠ {serverResult.warnings.length} Warning{serverResult.warnings.length > 1 ? "s" : ""}
                  </div>
                  {serverResult.warnings.map((w, i) => (
                    <div key={i} style={{ fontSize: "0.8rem", color: "var(--warning-fg)", marginBottom: 4 }}>• {w}</div>
                  ))}
                </div>
              )}

              {serverResult.billErrors?.length > 0 && (
                <div style={{ background: "var(--warning-bg)", border: "1px solid var(--warning)", borderRadius: 8, padding: "1rem", marginBottom: "1rem" }}>
                  <div style={{ color: "var(--warning-fg)", fontWeight: 600, marginBottom: "0.5rem", fontSize: "0.85rem" }}>
                    ⚠ {serverResult.billErrors.length} bill(s) failed to generate:
                  </div>
                  {serverResult.billErrors.map((e, i) => (
                    <div key={i} style={{ fontSize: "0.78rem", color: "var(--warning-fg)" }}>• {e}</div>
                  ))}
                </div>
              )}

              {serverResult.memberCreateErrors?.length > 0 && (
                <div style={{ background: "var(--danger-bg)", borderRadius: 8, padding: "1rem", marginBottom: "1rem" }}>
                  <div style={{ color: "var(--danger-fg)", fontWeight: 600, marginBottom: "0.5rem" }}>
                    {serverResult.memberCreateErrors.length} member(s) failed:
                  </div>
                  {serverResult.memberCreateErrors.map((e, i) => (
                    <div key={i} style={{ fontSize: "0.8rem", color: "var(--danger-fg)" }}>{e.flat}: {e.error}</div>
                  ))}
                </div>
              )}

              {serverResult.onboardingEmailErrors?.length > 0 && (
                <div style={{ background: "var(--danger-bg)", border: "1px solid var(--danger)", borderRadius: 8, padding: "1rem", marginBottom: "1rem" }}>
                  <div style={{ color: "var(--danger-fg)", fontWeight: 700, marginBottom: "0.5rem" }}>
                    ⚠ {serverResult.onboardingEmailErrors.length} onboarding email(s) failed to send
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "var(--danger-fg)", marginBottom: 8 }}>
                    Everything was created, but these members won't get their link by mail — use the Copy link column or the export below.
                  </div>
                  {serverResult.onboardingEmailErrors.map((e, i) => (
                    <div key={i} style={{ fontSize: "0.8rem", color: "var(--danger-fg)" }}>• {e}</div>
                  ))}
                </div>
              )}

              {serverResult.memberCredentials?.length > 0 && (
                <button
                  onClick={async () => {
                    const res = await fetch("/api/members/download-credentials", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      credentials: "include",
                      body: JSON.stringify({ credentials: serverResult.memberCredentials }),
                    });
                    if (!res.ok) { notify.error("Download failed"); return; }
                    const url = URL.createObjectURL(await res.blob());
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `Member_Credentials_${Date.now()}.xlsx`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  style={{ width: "100%", background: "var(--success)", color: "#fff", border: "none", padding: "0.75rem", borderRadius: 8, cursor: "pointer", fontWeight: 600, marginBottom: "0.75rem" }}
                >
                  📥 Download Member Credentials ({serverResult.memberCredentials.length} members)
                </button>
              )}

              {BillHistoryStep && !showBillHistory && !billHistoryDone && (
                <div style={{ background: "var(--primary)", border: "1px solid var(--accent)", borderRadius: 8, padding: "1rem", marginBottom: "0.75rem" }}>
                  <div style={{ color: "var(--accent)", fontWeight: 700, marginBottom: "0.4rem", fontSize: "0.9rem" }}>
                    📜 Step 4: Import Bill History (Recommended)
                  </div>
                  <div style={{ color: "var(--fg-5)", fontSize: "0.8rem", marginBottom: "0.75rem" }}>
                    Historical bills from the previous April up to the month before {serverResult.society?.name} joined. Required for correct opening balances and audit reports.
                  </div>
                  <button
                    onClick={() => setShowBillHistory(true)}
                    style={{ background: "var(--accent)", color: "#fff", border: "none", padding: "0.55rem 1.25rem", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: "0.85rem" }}
                  >Start Bill History Import →</button>
                </div>
              )}

              {BillHistoryStep && showBillHistory && !billHistoryDone && (
                <div style={{ background: "var(--bg-sunken)", border: "1px solid var(--border)", borderRadius: 8, padding: "1.25rem", marginBottom: "0.75rem" }}>
                  <BillHistoryStep
                    societyId={serverResult.society?.id}
                    societyName={serverResult.society?.name || ""}
                    joinPeriodId={serverResult.billPeriod || ""}
                    interestRate={21}
                    onComplete={() => setBillHistoryDone(true)}
                    onSkip={() => { setShowBillHistory(false); setBillHistoryDone(true); }}
                  />
                </div>
              )}

              {billHistoryDone && (
                <div style={{ background: "var(--success)22", border: "1px solid var(--success)", borderRadius: 8, padding: "0.75rem", marginBottom: "0.75rem", color: "var(--success)", fontSize: "0.85rem", fontWeight: 600 }}>
                  ✓ Bill History step complete
                </div>
              )}

              <button
                onClick={onClose}
                style={{ width: "100%", background: "var(--accent)", color: "#fff", border: "none", padding: "0.75rem", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}
              >Close</button>
            </div>
          )}
        </div>
      </div>
      <style jsx global>{`
        @keyframes bulkImportRowIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

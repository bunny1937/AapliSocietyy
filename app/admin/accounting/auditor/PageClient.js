"use client";
/**
 * Auditor workspace — Position / Statements / Corrections / Queries.
 * Design doc §8: "Auditors currently have no surface at all —
 * AuditorService.js exists, nothing consumes it."
 *
 * Position   — Trial Balance + a "Books balance ✓/✗" verdict at the top.
 * Statements — the same four-tab statements workspace, embedded read-only.
 * Corrections — the audit trail (same PageClient as the Books page's tab).
 * Queries    — AuditorNote: raise a query against an account head, resolve it.
 */
import { Fragment, Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import notify from "@/lib/notify";
import { fetchSetupState } from "@/lib/accounting/setupStateClient";
import {
  PageHeader, SectionLabel, Tabs, Card, Pill, Btn, Icon, EmptyState,
  RevampSkeleton,
} from "@/components/revamp";
import { StatementsWorkspace } from "../statements/PageClient";
import AuditTrailPage from "../audit-trail/PageClient";

const TABS = [
  { key: "position", label: "Position", icon: "scale" },
  { key: "statements", label: "Statements", icon: "file-text" },
  { key: "corrections", label: "Corrections", icon: "history" },
  { key: "queries", label: "Queries", icon: "message-circle-question" },
];

function AuditorPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromUrl = searchParams.get("tab");
  const [tab, setTab] = useState(TABS.some((t) => t.key === fromUrl) ? fromUrl : "position");

  const changeTab = useCallback((key) => {
    setTab(key);
    router.replace(`/admin/accounting/auditor?tab=${key}`, { scroll: false });
  }, [router]);

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="shield-check" size={11} /> Read-only, plus queries</>}
        title="Auditor workspace"
        sub="Trial Balance, the statutory statements, corrections, and queries raised against the books."
      />
      <Tabs value={tab} onChange={changeTab} tabs={TABS} />
      {tab === "position" ? <PositionTab /> : null}
      {tab === "statements" ? <StatementsWorkspace showHeader={false} basePath="/admin/accounting/auditor" initialTab="generate" /> : null}
      {tab === "corrections" ? <AuditTrailPage /> : null}
      {tab === "queries" ? <QueriesTab /> : null}
    </div>
  );
}

export default function AuditorPage() {
  return (
    <Suspense fallback={<div style={{ display: "grid", gap: 12 }}><RevampSkeleton h={90} /><RevampSkeleton h={220} /></div>}>
      <AuditorPageInner />
    </Suspense>
  );
}

/* ------------------------------------------------------------------ *
 * Position — Trial Balance + the verdict every auditor asks for first.
 * ------------------------------------------------------------------ */
function PositionTab() {
  const [tb, setTb] = useState(null);
  const [fy, setFy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Drill-through — same page, no new route. A row expands in place to show
  // the journal lines that add up to its figure, fetched from the same
  // General Ledger endpoint the Books page already uses.
  const [openAccountId, setOpenAccountId] = useState(null);
  const [ledgers, setLedgers] = useState({}); // accountId -> ledger | "loading" | error string

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const state = await fetchSetupState({ signal: ac.signal });
        const financialYear = state?.financialYear;
        setFy(financialYear || null);
        if (!financialYear) return;
        const res = await fetch(`/api/accounting/trial-balance?financialYearId=${financialYear._id}`, {
          credentials: "include", signal: ac.signal,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Could not load the Trial Balance");
        setTb(json.trialBalance);
      } catch (e) {
        if (e?.name !== "AbortError") setError(e.message);
      } finally {
        // A StrictMode double-mount (dev only) aborts the first of two runs of
        // this effect — without this guard its `finally` still clears loading
        // right away, flashing the empty state before the second, real fetch
        // resolves seconds later.
        if (!ac.signal.aborted) setLoading(false);
      }
    })();
    return () => ac.abort();
  }, []);

  const toggleLedger = async (accountId) => {
    setOpenAccountId((cur) => (cur === accountId ? null : accountId));
    if (ledgers[accountId]) return;
    setLedgers((l) => ({ ...l, [accountId]: "loading" }));
    try {
      const res = await fetch(`/api/accounting/general-ledger?accountId=${accountId}&financialYearId=${fy._id}`, { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load the entries");
      setLedgers((l) => ({ ...l, [accountId]: json.ledger }));
    } catch (e) {
      setLedgers((l) => ({ ...l, [accountId]: e.message }));
    }
  };

  if (loading) return <RevampSkeleton h={260} />;
  if (error) return <Card><EmptyState icon="alert-triangle" title="Could not load the Trial Balance" sub={error} /></Card>;
  if (!fy) return <Card><EmptyState icon="calendar" title="No Financial Year yet" sub="There is nothing to verify until a year exists." /></Card>;
  if (!tb) return <Card><EmptyState icon="scale" title="No activity yet" sub={`Nothing posted in ${fy.label} yet.`} /></Card>;

  return (
    <>
      <Card style={{
        marginBottom: 16, borderColor: tb.isBalanced ? "var(--r-success)" : "var(--r-danger)",
        display: "flex", alignItems: "center", gap: 14,
      }}>
        <Icon name={tb.isBalanced ? "check-circle" : "alert-triangle"} size={26} color={tb.isBalanced ? "var(--r-success)" : "var(--r-danger)"} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--r-fg-1)" }}>
            {tb.isBalanced ? "The books balance." : "The books do NOT balance."}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--r-fg-3)", marginTop: 3 }}>
            {tb.financialYearLabel} · Debit ₹{tb.totalDebit.toLocaleString("en-IN")} · Credit ₹{tb.totalCredit.toLocaleString("en-IN")}
            {!tb.isBalanced ? ` · difference ₹${Math.abs(tb.difference).toLocaleString("en-IN")}` : ""}
          </div>
        </div>
        <Pill tone={tb.isBalanced ? "paid" : "overdue"}>{tb.isBalanced ? "Balanced" : "Out of balance"}</Pill>
      </Card>

      <SectionLabel icon="list-checks">Trial Balance — {tb.rows.length} accounts with activity</SectionLabel>
      <Card padded={false} style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "10px 14px", fontSize: 11.5, color: "var(--r-fg-4)", borderBottom: "1px solid var(--r-hairline)" }}>Account</th>
              <th style={{ textAlign: "right", padding: "10px 14px", fontSize: 11.5, color: "var(--r-fg-4)", borderBottom: "1px solid var(--r-hairline)" }}>Debit</th>
              <th style={{ textAlign: "right", padding: "10px 14px", fontSize: 11.5, color: "var(--r-fg-4)", borderBottom: "1px solid var(--r-hairline)" }}>Credit</th>
            </tr>
          </thead>
          <tbody>
            {tb.rows.map((r, i) => {
              const open = openAccountId === r.accountId;
              const ledger = ledgers[r.accountId];
              return (
                <Fragment key={r.accountId}>
                  <tr
                    onClick={() => toggleLedger(r.accountId)}
                    style={{ borderBottom: !open && i === tb.rows.length - 1 ? "none" : "1px solid var(--r-hairline)", cursor: "pointer" }}
                    title="See the entries behind this figure"
                  >
                    <td style={{ padding: "9px 14px", color: "var(--r-fg-1)" }}>
                      <Icon name={open ? "chevron-down" : "chevron-right"} size={11} color="var(--r-fg-5)" style={{ marginRight: 6 }} />
                      <span className="revamp-num" style={{ color: "var(--r-fg-4)", marginRight: 8 }}>{r.code}</span>{r.name}
                    </td>
                    <td style={{ padding: "9px 14px", textAlign: "right", color: "var(--r-fg-2)" }}>{r.debit ? `₹${r.debit.toLocaleString("en-IN")}` : "—"}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", color: "var(--r-fg-2)" }}>{r.credit ? `₹${r.credit.toLocaleString("en-IN")}` : "—"}</td>
                  </tr>
                  {open ? (
                    <tr style={{ borderBottom: i === tb.rows.length - 1 ? "none" : "1px solid var(--r-hairline)" }}>
                      <td colSpan={3} style={{ padding: "0 14px 14px", background: "var(--r-surface-2)" }}>
                        {ledger === "loading" ? (
                          <div style={{ fontSize: 12, color: "var(--r-fg-4)", padding: "8px 0" }}>Loading entries…</div>
                        ) : typeof ledger === "string" ? (
                          <div style={{ fontSize: 12, color: "var(--r-danger)", padding: "8px 0" }}>{ledger}</div>
                        ) : ledger?.lines.length === 0 ? (
                          <div style={{ fontSize: 12, color: "var(--r-fg-4)", padding: "8px 0" }}>No entries this financial year — the balance is carried in as an opening figure.</div>
                        ) : ledger ? (
                          <div style={{ overflowX: "auto", marginTop: 6 }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                              <thead>
                                <tr>
                                  <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11, color: "var(--r-fg-4)" }}>Date</th>
                                  <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11, color: "var(--r-fg-4)" }}>Voucher</th>
                                  <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11, color: "var(--r-fg-4)" }}>Narration</th>
                                  <th style={{ textAlign: "right", padding: "6px 8px", fontSize: 11, color: "var(--r-fg-4)" }}>Debit</th>
                                  <th style={{ textAlign: "right", padding: "6px 8px", fontSize: 11, color: "var(--r-fg-4)" }}>Credit</th>
                                </tr>
                              </thead>
                              <tbody>
                                {ledger.lines.map((l) => (
                                  <tr key={l.lineId}>
                                    <td style={{ padding: "5px 8px", color: "var(--r-fg-3)" }}>{new Date(l.date).toLocaleDateString("en-IN")}</td>
                                    <td style={{ padding: "5px 8px", color: "var(--r-fg-3)" }}>{l.voucherNumber || "—"}</td>
                                    <td style={{ padding: "5px 8px", color: "var(--r-fg-2)" }}>{l.narration || "—"}</td>
                                    <td style={{ padding: "5px 8px", textAlign: "right", color: "var(--r-fg-2)" }}>{l.debit ? `₹${l.debit.toLocaleString("en-IN")}` : "—"}</td>
                                    <td style={{ padding: "5px 8px", textAlign: "right", color: "var(--r-fg-2)" }}>{l.credit ? `₹${l.credit.toLocaleString("en-IN")}` : "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Queries — AuditorNote CRUD. Note: raises against an account head only in
 * this first pass (a Voucher-targeted picker needs the Entries list wired in
 * — left for a follow-up rather than guessed at).
 * ------------------------------------------------------------------ */
function QueriesTab() {
  const [notes, setNotes] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [targetId, setTargetId] = useState("");
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [notesRes, acctRes] = await Promise.all([
        fetch("/api/accounting/auditor/notes", { credentials: "include" }),
        fetch("/api/accounting/chart-of-accounts", { credentials: "include" }),
      ]);
      const notesJson = await notesRes.json().catch(() => ({}));
      const acctJson = await acctRes.json().catch(() => ({}));
      if (!notesRes.ok) throw new Error(notesJson.error || "Could not load queries");
      setNotes(notesJson.notes || []);
      setAccounts(acctJson.accounts || []);
    } catch (e) {
      notify.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const raise = useCallback(async () => {
    if (!targetId || !text.trim()) return;
    setPosting(true);
    try {
      const account = accounts.find((a) => a._id === targetId);
      const res = await fetch("/api/accounting/auditor/notes", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: "ChartOfAccount", targetId,
          targetLabel: account ? `${account.code} ${account.name}` : undefined,
          note: text.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not raise the query");
      notify.success("Query raised.");
      setText(""); setTargetId("");
      await load();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setPosting(false);
    }
  }, [targetId, text, accounts, load]);

  const resolve = useCallback(async (id, resolution) => {
    try {
      const res = await fetch(`/api/accounting/auditor/notes/${id}/resolve`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not resolve the query");
      notify.success("Query resolved.");
      await load();
    } catch (e) {
      notify.error(e.message);
    }
  }, [load]);

  const open = notes.filter((n) => n.status === "Open");
  const resolved = notes.filter((n) => n.status === "Resolved");

  if (loading) return <RevampSkeleton h={220} />;

  return (
    <>
      <Card style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Raise a query against an account head</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--r-hairline)", background: "var(--r-surface-1)", color: "var(--r-fg-1)", fontSize: 13, minWidth: 220 }}
          >
            <option value="">Choose an account…</option>
            {accounts.map((a) => <option key={a._id} value={a._id}>{a.code} — {a.name}</option>)}
          </select>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What needs explaining?"
            style={{ flex: 1, minWidth: 220, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--r-hairline)", background: "var(--r-surface-1)", color: "var(--r-fg-1)", fontSize: 13 }}
          />
          <Btn variant="primary" disabled={posting || !targetId || !text.trim()} onClick={raise}>
            {posting ? "…" : "Raise query"}
          </Btn>
        </div>
      </Card>

      <SectionLabel icon="alert-circle">{open.length} open</SectionLabel>
      {open.length === 0 ? (
        <Card><EmptyState icon="check-circle" title="No open queries" sub="Nothing outstanding right now." /></Card>
      ) : (
        <Card padded={false} style={{ marginBottom: 20 }}>
          {open.map((n, i, arr) => (
            <QueryRow key={n._id} note={n} last={i === arr.length - 1} onResolve={resolve} />
          ))}
        </Card>
      )}

      {resolved.length ? (
        <>
          <SectionLabel icon="check-circle">{resolved.length} resolved</SectionLabel>
          <Card padded={false}>
            {resolved.map((n, i, arr) => (
              <QueryRow key={n._id} note={n} last={i === arr.length - 1} />
            ))}
          </Card>
        </>
      ) : null}
    </>
  );
}

function QueryRow({ note, last, onResolve }) {
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState("");
  return (
    <div style={{ padding: "12px 15px", borderBottom: last ? "none" : "1px solid var(--r-hairline)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--r-fg-1)" }}>{note.targetLabel || note.targetType}</div>
          <div style={{ fontSize: 12.5, color: "var(--r-fg-2)", marginTop: 3 }}>{note.note}</div>
          <div style={{ fontSize: 11, color: "var(--r-fg-4)", marginTop: 4 }}>
            Raised by {note.raisedByName || "—"} · {new Date(note.raisedAt).toLocaleDateString("en-IN")}
          </div>
          {note.status === "Resolved" ? (
            <div style={{ fontSize: 11.5, color: "var(--r-success)", marginTop: 5 }}>
              ✓ {note.resolution} — {note.resolvedByName || "—"}
            </div>
          ) : null}
        </div>
        {note.status === "Open" && onResolve ? (
          resolving ? (
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="Resolution"
                style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--r-hairline)", background: "var(--r-surface-1)", color: "var(--r-fg-1)", fontSize: 12 }}
              />
              <Btn size="sm" variant="primary" disabled={!resolution.trim()} onClick={() => { onResolve(note._id, resolution); setResolving(false); }}>
                Save
              </Btn>
            </div>
          ) : (
            <Btn size="sm" onClick={() => setResolving(true)}>Resolve</Btn>
          )
        ) : null}
      </div>
    </div>
  );
}

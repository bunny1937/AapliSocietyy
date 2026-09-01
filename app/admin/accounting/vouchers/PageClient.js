"use client";
/**
 * Entries — the receipts and payment slips the books are actually made of.
 *
 * ## The word this page exists to kill
 *
 * "Voucher". It appears in the API, the model, the auditor's vocabulary and
 * nowhere in a society secretary's. A voucher is one slip: one receipt, one
 * payment, one adjustment. So the page is called Entries, each row reads as a
 * slip, and "voucher" is kept only as an aside for whoever has to talk to the
 * auditor.
 *
 * ## Why every entry opens to show two halves
 *
 * The one accounting idea a person has to hold is that an entry has two sides
 * that must match. Hiding the lines makes an entry look like a single number
 * in a list, which is exactly the misunderstanding that makes the rest of the
 * system impossible to reason about. So expanding a row fetches its journal
 * entry and shows both halves with the account names spelled out and the two
 * totals side by side.
 *
 * ## Why the actions carry consequences in their own text
 *
 * Cancel and Reverse are not the same thing and the difference matters more
 * than anything else on the page:
 *
 *   Cancel  — only a Draft. Nothing was ever in the books. It disappears.
 *   Reverse — a Posted entry. It stays, and an equal and opposite entry is
 *             written beside it. The books keep both, because that is what an
 *             audit trail is.
 *
 * A person who reaches for "cancel" on a posted entry is asking to erase
 * history, so the page says so rather than just disabling a button.
 *
 * ## A note on what was found here
 *
 * All five workflow routes had no permission check at all — only the legacy
 * hat gate, which by its own documented design lets any RBAC staff token
 * through on the assumption an authorize() call follows. None did, so a
 * guard's token could reverse a posted entry. Phase 5 added the
 * accounting.vouchers.* permissions and wired them in.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchSetupState } from "@/lib/accounting/setupStateClient";
import { useRouter } from "next/navigation";
import notify from "@/lib/notify";
import { SetupGate } from "@/components/accounting/SetupGate";
import {
  PageHeader, SectionLabel, Card, Pill, Btn, Icon, SearchInput,
  Segmented, EmptyState, RevampSkeleton, SmallStat,
} from "@/components/revamp";

/** Voucher type → what kind of slip it is. */
const TYPES = {
  Receipt: "Money received",
  Payment: "Money paid out",
  Journal: "Adjustment",
  Contra: "Moved between cash and bank",
  DebitNote: "Charge raised",
  CreditNote: "Charge reduced",
};

/** Status → what it means for the books, not what the enum says. */
const STATUS = {
  Draft: { label: "Not in the books yet", tone: "scheduled" },
  Posted: { label: "In the books", tone: "paid" },
  Reversed: { label: "Reversed", tone: "expired" },
  Cancelled: { label: "Cancelled", tone: "expired" },
};

const APPROVAL = {
  Pending: { label: "Waiting for approval", tone: "partial" },
  Approved: { label: "Approved", tone: "paid" },
  Rejected: { label: "Rejected", tone: "unpaid" },
};

/** Where each entry came from, in words. */
const SOURCES = {
  Billing: "raised with the bills",
  Payments: "recorded against a payment",
  Interest: "interest run",
  OpeningBalance: "carried in from last year",
  Manual: "entered by hand",
  Assets: "asset register",
  Liabilities: "liability register",
  Funds: "fund transfer",
  Auditor: "auditor",
  Migration: "migrated",
  Import: "imported",
};

const money = (n) =>
  typeof n === "number"
    ? n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 })
    : "—";

/** What actually changed, per action. */
const DONE_TEXT = {
  "submit-for-approval": "Sent for approval. It stays out of the books until someone approves it.",
  approve: "Approved. It can now reach the books.",
  reject: "Rejected. Nothing reached the books, and the reason is on the entry.",
  cancel: "Draft cancelled. No figures on any statement changed.",
  reverse: "Reversal entry created beside the original. Both stay in the books and cancel each other out.",
};

const dateText = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";

// A payment can be recorded (Bill/Transaction/Receipt) without ever reaching
// the books if the ledger-posting call fails or — as found 2026-08-30 — was
// never wired up at all in two of the four payment routes. This bar makes
// that gap visible instead of the Balance Sheet just quietly being short.
function LedgerGapsBar({ onFixed }) {
  const [state, setState] = useState({ loading: true, count: 0, enabled: true });
  const [fixing, setFixing] = useState(false);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/accounting/ledger-gaps", { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not check for missing ledger entries");
      setState({ loading: false, count: json.count || 0, enabled: json.accountingEnabled !== false });
    } catch {
      setState({ loading: false, count: 0, enabled: true });
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  if (state.loading || !state.enabled || state.count === 0) return null;

  const fix = async () => {
    setFixing(true);
    try {
      const res = await fetch("/api/admin/accounting/ledger-gaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not post the missing entries");
      notify.success(`Posted ${json.posted} entr${json.posted === 1 ? "y" : "ies"} to the books.`);
      await check();
      onFixed?.();
    } catch (e) {
      notify.error(e.message || "Could not post the missing entries");
    } finally {
      setFixing(false);
    }
  };

  return (
    <Card style={{ marginBottom: 16, borderColor: "var(--r-danger)", background: "var(--r-danger-soft)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "4px 2px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: "var(--r-fg-1)" }}>
          <strong>{state.count} payment{state.count === 1 ? "" : "s"} never reached the books.</strong>{" "}
          The money was received and recorded, but no Journal Entry was posted for it — the Balance Sheet is short by that much.
        </div>
        <Btn variant="primary" icon="zap" onClick={fix} disabled={fixing}>
          {fixing ? "Posting…" : "Post missing entries"}
        </Btn>
      </div>
    </Card>
  );
}

export default function VouchersPage() {
  return (
    <SetupGate requires="financialYear">
      <VouchersBody />
    </SetupGate>
  );
}

function VouchersBody() {
  const router = useRouter();
  const [vouchers, setVouchers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [perms, setPerms] = useState(null);
  const [fy, setFy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [openId, setOpenId] = useState(null);
  const [entries, setEntries] = useState({}); // voucherId -> journal entry
  const [busy, setBusy] = useState(null);
  // { id, action, label, blurb } — the confirmation being asked for
  // inline, below the entry it applies to.
  const [asking, setAsking] = useState(null);
  const [reason, setReason] = useState("");
  // Deep-link support: an Account Ledger drill-down "Open voucher" link lands
  // here as /admin/accounting/books?tab=entries&open=<voucherId>&q=<number>
  // — read once on mount via window.location so this doesn't need a
  // Suspense boundary just for two query params.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const open = sp.get("open");
    const query = sp.get("q");
    if (query) setQ(query);
    if (open) setOpenId(open);
  }, []);

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      // Throws rather than degrading to null on a 5xx: a cold-start 503 used
      // to render this page as an honest-looking empty list.
      const state = await fetchSetupState({ signal });
      const fyId = state?.financialYear?.id;
      setFy(state?.financialYear || null);

      const [vRes, aRes, pRes] = await Promise.all([
        fetch(`/api/accounting/vouchers${fyId ? `?financialYearId=${fyId}` : ""}`, {
          credentials: "include", signal,
        }),
        fetch("/api/accounting/chart-of-accounts", { credentials: "include", signal }),
        fetch("/api/rbac/my-access", { credentials: "include", signal }),
      ]);
      const vJson = await vRes.json().catch(() => ({}));
      if (!vRes.ok) throw new Error(vJson.error || "Could not load the entries");
      setVouchers(vJson.vouchers || []);
      // Both of these are supporting detail. A failure narrows the page (no
      // account names, fewer buttons) rather than taking it down.
      if (aRes.ok) setAccounts((await aRes.json().catch(() => ({}))).accounts || []);
      if (pRes.ok) setPerms(new Set((await pRes.json().catch(() => ({}))).permissions || []));
    } catch (e) {
      if (e?.name !== "AbortError") setError(e.message);
    } finally {
      // A StrictMode double-mount (dev only) aborts the first of two calls to
      // this load() — without this guard its `finally` still clears loading
      // right away, flashing the empty state before the second, real fetch
      // resolves seconds later.
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const accountName = useCallback(
    (id) => {
      const a = accounts.find((x) => String(x._id) === String(id));
      return a ? `${a.code} ${a.name}` : "an account head";
    },
    [accounts],
  );

  /** Expanding a row is when the lines are worth fetching, not before. */
  const toggle = useCallback(
    async (v) => {
      const id = String(v._id);
      if (openId === id) return setOpenId(null);
      setOpenId(id);
      if (entries[id] !== undefined || !v.journalEntryId) return;
      try {
        const res = await fetch(`/api/accounting/journal-entries/${v.journalEntryId}`, {
          credentials: "include",
        });
        const json = await res.json().catch(() => ({}));
        setEntries((e) => ({ ...e, [id]: res.ok ? json.journalEntry : null }));
      } catch {
        setEntries((e) => ({ ...e, [id]: null }));
      }
    },
    [openId, entries],
  );

  /**
   * One path for all five workflow actions.
   *
   * Reject, cancel and reverse all 400 without a reason, and the reason is
   * kept on the entry forever — so it is asked for in the page, next to the
   * entry it belongs to, with the consequence spelled out above the box. Not
   * in a browser prompt: a grey box with no context is the opposite of
   * showing someone what they are about to do.
   */
  const act = useCallback(
    async (v, action, reason) => {
      setBusy(`${v._id}:${action}`);
      try {
        const res = await fetch(`/api/accounting/vouchers/${v._id}/${action}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reason ? { reason } : {}),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "That did not go through");
        // Say what changed, not "Done." — the whole point of the page.
        notify.success(DONE_TEXT[action] || "Done.");
        setEntries({});
        setAsking(null);
        await load();
      } catch (e) {
        notify.error(e.message);
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  /** Open the inline confirmation for one entry, with a clean reason box. */
  const ask = useCallback((id, action, label, blurb) => {
    setReason("");
    setAsking({ id, action, label, blurb });
  }, []);

  const can = useCallback((id) => !perms || perms.has(id), [perms]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return vouchers.filter((v) => {
      if (status !== "all" && v.status !== status) return false;
      if (!needle) return true;
      return [v.voucherNumber, v.narration, v.voucherType, v.sourceModule]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(needle));
    });
  }, [vouchers, q, status]);

  const counts = useMemo(() => {
    const c = { Draft: 0, Posted: 0, Reversed: 0, Cancelled: 0, pending: 0 };
    for (const v of vouchers) {
      if (c[v.status] !== undefined) c[v.status] += 1;
      if (v.approvalStatus === "Pending") c.pending += 1;
    }
    return c;
  }, [vouchers]);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="file-text" size={11} /> Also called vouchers</>}
        title="Entries"
        sub={
          fy
            ? `Every receipt and payment slip recorded in ${fy.label} — the same slips as the paper cash book, each with two halves that match.`
            : "Every receipt and payment slip recorded — the same slips as the paper cash book."
        }
        right={<Btn icon="arrow-left" onClick={() => router.push("/admin/accounting")}>Overview</Btn>}
      />

      {!loading && !error && <LedgerGapsBar onFixed={() => load()} />}

      {loading ? (
        <div style={{ display: "grid", gap: 12 }}>
          <RevampSkeleton h={80} /><RevampSkeleton h={260} />
        </div>
      ) : error ? (
        <Card>
          <EmptyState icon="alert-triangle" title="Could not load the entries" sub={error} />
          <div style={{ textAlign: "center", paddingBottom: 20 }}>
            <Btn variant="primary" onClick={() => load()}>Try again</Btn>
          </div>
        </Card>
      ) : vouchers.length === 0 ? (
        <Card>
          <div style={{ padding: "36px 24px", textAlign: "center", maxWidth: 540, margin: "0 auto" }}>
            <Icon name="file-text" size={30} color="var(--r-fg-5)" style={{ margin: "0 auto" }} />
            <p style={{ marginTop: 12, fontSize: 15, fontWeight: 600, color: "var(--r-fg-1)" }}>
              Nothing recorded yet
            </p>
            <p style={{ marginTop: 8, fontSize: 13, color: "var(--r-fg-3)", lineHeight: 1.65 }}>
              Entries are not typed in here one by one. Raising this month's
              bills and recording the payments that come back creates them on
              their own — this page is where you come to see what was recorded
              and check it.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
              <Btn variant="primary" icon="zap" onClick={() => router.push("/admin/generate-bills")}>
                Raise this month's bills
              </Btn>
              <Btn onClick={() => router.push("/admin/accounting")}>What else is missing?</Btn>
            </div>
          </div>
        </Card>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 18 }}>
            <SmallStat icon="file-text" label="Entries this year" value={vouchers.length} />
            <SmallStat icon="check-circle" label="In the books" value={counts.Posted} />
            <SmallStat icon="edit" label="Still drafts" value={counts.Draft} />
            <SmallStat icon="clock" label="Waiting for approval" value={counts.pending} />
          </div>

          {counts.pending ? (
            <Card style={{ marginBottom: 16, borderColor: "var(--r-warning)" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <Icon name="clock" size={18} color="var(--r-warning)" />
                <div style={{ flex: 1, fontSize: 12.5, color: "var(--r-fg-3)", lineHeight: 1.6 }}>
                  {counts.pending} entr{counts.pending === 1 ? "y is" : "ies are"} waiting
                  for someone to approve {counts.pending === 1 ? "it" : "them"}. Until
                  then {counts.pending === 1 ? "it stays" : "they stay"} out of the books
                  and off every statement.
                </div>
                <Btn size="sm" onClick={() => setStatus("Draft")}>Show them</Btn>
              </div>
            </Card>
          ) : null}

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
            <SearchInput value={q} onChange={setQ} placeholder="Search number or note…" style={{ maxWidth: 260 }} />
            <Segmented
              value={status}
              onChange={setStatus}
              options={[
                { value: "all", label: "All" },
                { value: "Draft", label: "Drafts" },
                { value: "Posted", label: "In the books" },
                { value: "Reversed", label: "Reversed" },
                { value: "Cancelled", label: "Cancelled" },
              ]}
            />
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--r-fg-4)" }}>
              {visible.length} shown
            </span>
          </div>

          {visible.length === 0 ? (
            <Card><EmptyState icon="search" title="Nothing matches" sub="Try a different search or filter." /></Card>
          ) : (
            <Card padded={false}>
              {visible.map((v, i) => {
                const id = String(v._id);
                const open = openId === id;
                const st = STATUS[v.status] || { label: v.status, tone: "neutral" };
                const ap = APPROVAL[v.approvalStatus];
                const entry = entries[id];
                return (
                  <div
                    key={id}
                    style={{ borderBottom: i === visible.length - 1 ? "none" : "1px solid var(--r-hairline)" }}
                  >
                    <div
                      onClick={() => toggle(v)}
                      style={{ display: "flex", gap: 12, padding: "12px 15px", alignItems: "center", cursor: "pointer" }}
                    >
                      <Icon name={open ? "chevron-down" : "chevron-right"} size={14} color="var(--r-fg-5)" />
                      <span className="revamp-num" style={{ fontSize: 12, fontWeight: 700, color: "var(--r-fg-4)", width: 92, flexShrink: 0 }}>
                        {v.voucherNumber}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--r-fg-4)", width: 92, flexShrink: 0 }}>
                        {dateText(v.date)}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--r-fg-1)" }}>
                        {v.narration || TYPES[v.voucherType] || v.voucherType}
                        <span style={{ color: "var(--r-fg-4)", fontSize: 11.5 }}>
                          {" · "}{TYPES[v.voucherType] || v.voucherType}
                          {SOURCES[v.sourceModule] ? `, ${SOURCES[v.sourceModule]}` : ""}
                        </span>
                      </span>
                      {ap ? <Pill tone={ap.tone}>{ap.label}</Pill> : null}
                      <Pill tone={st.tone}>{st.label}</Pill>
                    </div>

                    {open ? (
                      <div style={{ padding: "0 15px 14px 41px" }}>
                        {/* ── the two halves ─────────────────────────── */}
                        {!v.journalEntryId ? (
                          <div style={{ fontSize: 12.5, color: "var(--r-fg-3)", lineHeight: 1.65 }}>
                            This entry has no lines yet — it is still a draft
                            heading. Nothing has been written to the books, and
                            nothing appears on any statement.
                          </div>
                        ) : entry === undefined ? (
                          <RevampSkeleton h={60} />
                        ) : entry === null ? (
                          <div style={{ fontSize: 12.5, color: "var(--r-fg-4)" }}>
                            Could not load the two halves of this entry.
                          </div>
                        ) : (
                          <>
                            <SectionLabel icon="columns">The two halves</SectionLabel>
                            <div style={{ display: "grid", gap: 4, marginBottom: 8 }}>
                              {(entry.lines || []).map((l, j) => (
                                <div key={j} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 12.5 }}>
                                  <span style={{
                                    width: 52, flexShrink: 0, fontSize: 11, fontWeight: 700,
                                    color: l.side === "Debit" ? "var(--r-success)" : "var(--r-accent)",
                                  }}>
                                    {l.side}
                                  </span>
                                  <span style={{ flex: 1, minWidth: 0, color: "var(--r-fg-2)" }}>
                                    {accountName(l.accountId)}
                                    {l.narration ? (
                                      <span style={{ color: "var(--r-fg-4)" }}> — {l.narration}</span>
                                    ) : null}
                                  </span>
                                  <span className="revamp-num" style={{ color: "var(--r-fg-1)" }}>
                                    {money(l.amount)}
                                  </span>
                                </div>
                              ))}
                            </div>
                            <div style={{ display: "flex", gap: 18, fontSize: 12, color: "var(--r-fg-3)", paddingTop: 6, borderTop: "1px solid var(--r-hairline)" }}>
                              <span>Debit total <strong className="revamp-num">{money(entry.totalDebit)}</strong></span>
                              <span>Credit total <strong className="revamp-num">{money(entry.totalCredit)}</strong></span>
                              <span style={{ color: entry.totalDebit === entry.totalCredit ? "var(--r-success)" : "var(--r-danger)" }}>
                                {entry.totalDebit === entry.totalCredit ? "The two sides match." : "The two sides do not match."}
                              </span>
                            </div>
                          </>
                        )}

                        {/* ── what can be done to it now ─────────────── */}
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                          {v.status === "Draft" && v.approvalStatus !== "Pending" && can("accounting.vouchers.submit") ? (
                            <Btn
                              size="sm"
                              disabled={busy === `${id}:submit-for-approval`}
                              onClick={() => act(v, "submit-for-approval")}
                              title="Sends it to whoever approves entries. It still does not reach the books until they approve."
                            >
                              Send for approval
                            </Btn>
                          ) : null}
                          {v.approvalStatus === "Pending" && can("accounting.vouchers.approve") ? (
                            <Btn
                              size="sm"
                              variant="primary"
                              disabled={busy === `${id}:approve`}
                              onClick={() => act(v, "approve")}
                            >
                              Approve
                            </Btn>
                          ) : null}
                          {v.approvalStatus === "Pending" && can("accounting.vouchers.reject") ? (
                            <Btn
                              size="sm"
                              disabled={busy === `${id}:reject`}
                              onClick={() => ask(id, "reject", "Reject this entry",
                                "It goes back to whoever recorded it. Nothing reaches the books. Why is it being rejected? The reason stays on the entry.")}
                            >
                              Reject
                            </Btn>
                          ) : null}
                          {v.status === "Draft" && can("accounting.vouchers.cancel") ? (
                            <Btn
                              size="sm"
                              variant="danger"
                              disabled={busy === `${id}:cancel`}
                              onClick={() => ask(id, "cancel", "Cancel this draft",
                                "This entry was never in the books, so cancelling it changes no figures on any statement. Why is it being cancelled? The reason stays on the entry.")}
                            >
                              Cancel this draft
                            </Btn>
                          ) : null}
                          {v.status === "Posted" && can("accounting.vouchers.reverse") ? (
                            <Btn
                              size="sm"
                              variant="danger"
                              disabled={busy === `${id}:reverse`}
                              onClick={() => ask(id, "reverse", "Reverse this entry",
                                "This entry STAYS in the books. An equal and opposite entry is written beside it, so the two cancel out and both remain on record — that is what an audit trail is. Why is it being reversed?")}
                            >
                              Reverse
                            </Btn>
                          ) : null}
                          {v.status === "Posted" ? (
                            <span style={{ fontSize: 11.5, color: "var(--r-fg-4)", alignSelf: "center" }}>
                              A posted entry is never deleted. Reversing writes an
                              opposite entry beside it and keeps both.
                            </span>
                          ) : null}
                        </div>

                        {asking && asking.id === id ? (
                          <div style={{
                            marginTop: 10, padding: "12px 13px", borderRadius: 10,
                            border: "1px solid var(--r-warning)", background: "var(--r-surface-2)",
                          }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--r-fg-1)" }}>
                              {asking.label}
                            </div>
                            <div style={{ fontSize: 12.5, color: "var(--r-fg-3)", marginTop: 4, lineHeight: 1.65 }}>
                              {asking.blurb}
                            </div>
                            <textarea
                              value={reason}
                              autoFocus
                              onChange={(e) => setReason(e.target.value)}
                              placeholder="Write the reason here"
                              rows={2}
                              style={{
                                width: "100%", marginTop: 8, padding: "7px 9px", borderRadius: 7,
                                border: "1px solid var(--r-border)", background: "var(--r-surface)",
                                color: "var(--r-fg-1)", fontSize: 12.5, fontFamily: "inherit", resize: "vertical",
                              }}
                            />
                            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                              <Btn
                                size="sm"
                                variant="dangerSolid"
                                disabled={!reason.trim() || busy === `${id}:${asking.action}`}
                                onClick={() => act(v, asking.action, reason.trim())}
                              >
                                {busy === `${id}:${asking.action}` ? "Working…" : asking.label}
                              </Btn>
                              <Btn size="sm" onClick={() => setAsking(null)}>Leave it as it is</Btn>
                              {!reason.trim() ? (
                                <span style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>
                                  A reason is required — it stays on the entry.
                                </span>
                              ) : null}
                            </div>
                          </div>
                        ) : null}

                        {v.cancellationReason ? (
                          <div style={{ fontSize: 11.5, color: "var(--r-fg-4)", marginTop: 8 }}>
                            Cancelled: {v.cancellationReason}
                          </div>
                        ) : null}
                        {v.rejectionReason ? (
                          <div style={{ fontSize: 11.5, color: "var(--r-fg-4)", marginTop: 8 }}>
                            Rejected: {v.rejectionReason}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </Card>
          )}

          <p style={{ fontSize: 12, color: "var(--r-fg-4)", lineHeight: 1.65, marginTop: 12 }}>
            Most of these write themselves. Raising bills and recording payments
            creates the entries through the automatic rules; entering one by hand
            is for corrections and for money that arrives outside the billing
            system. Nothing on this list is ever deleted — a draft can be
            cancelled before it reaches the books, and anything already in them
            is reversed instead, which leaves both entries on record.
          </p>
        </>
      )}
    </div>
  );
}

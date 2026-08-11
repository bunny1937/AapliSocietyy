"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import RSelect from "react-select";
import {
  Card, PageHeader, Button, Badge, Spinner, Toast, EmptyState,
  Modal, StatCard, tokens, grid, Field, Input, Select, Textarea,
} from "@/components/visitor/ui";

async function api(url, opts) {
  const res = await fetch(url, {
    credentials: "include",
    headers: opts && opts.body ? { "Content-Type": "application/json" } : undefined,
    ...opts,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || "Request failed");
  return data;
}

const MODES = ["", "Cash", "Cheque", "Online", "UPI", "NEFT", "RTGS", "System"];
const RECORD_MODES = ["Cash", "Cheque", "Online", "UPI", "NEFT", "RTGS"];
const DASH = "—";
const money = (n) => `Rs ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (v) => {
  if (!v) return DASH;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? DASH : d.toLocaleDateString("en-IN");
};

const S = {
  tabs: { display: "flex", gap: 6, marginBottom: 18, borderBottom: `1px solid ${tokens.border.split(" ").pop()}` },
  tab: (active) => ({
    padding: "10px 16px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    color: active ? tokens.primary : tokens.sub,
    borderBottom: active ? `2px solid ${tokens.primary}` : "2px solid transparent",
    marginBottom: -1,
    background: "none",
    border: "none",
    borderBottomWidth: 2,
  }),
  filters: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 },
  fl: { display: "grid", gap: 4 },
  lbl: { fontSize: 11.5, color: tokens.sub, fontWeight: 600 },
  inp: { padding: "7px 10px", borderRadius: 8, border: `1px solid ${tokens.border}`, fontSize: 13 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "10px 8px", borderBottom: `2px solid ${tokens.border}`, color: tokens.sub, fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap" },
  td: { padding: "10px 8px", borderBottom: `1px solid ${tokens.border}`, verticalAlign: "top" },
  num: { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  center: { display: "flex", justifyContent: "center", padding: 48 },
  pager: { display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", marginTop: 14 },
  sub: { fontSize: 11.5, color: tokens.sub },
};

const EMPTY_FILTERS = { paymentMode: "", from: "", to: "", includeReversed: false };

export default function PaymentsPage() {
  const [tab, setTab] = useState("received"); // received | pending
  const [toast, setToast] = useState(null);

  // ── Received list state (folded in from the old payments-received page) ──
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [edit, setEdit] = useState(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), limit: "50" });
      if (filters.paymentMode) p.set("paymentMode", filters.paymentMode);
      if (filters.from) p.set("from", filters.from);
      if (filters.to) p.set("to", filters.to);
      if (filters.includeReversed) p.set("includeReversed", "1");
      setData(await api(`/api/admin/payments/received?${p.toString()}`));
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => { if (tab === "received") load(); }, [load, tab]);

  const rows = useMemo(() => {
    const list = (data && data.payments) || [];
    const term = q.trim().toLowerCase();
    if (!term) return list;
    return list.filter((r) =>
      [r.transactionId, r.description, r.notes, r.transactionRef, r.chequeNo,
        r.member && r.member.flatNo, r.member && r.member.ownerName]
        .filter(Boolean).join(" ").toLowerCase().includes(term),
    );
  }, [data, q]);

  const summary = (data && data.summary) || { count: 0, amount: 0, interest: 0, principal: 0, advance: 0 };

  async function saveEdit() {
    setSaving(true);
    try {
      await api(`/api/admin/payments/received/${edit._id}`, {
        method: "PATCH",
        body: JSON.stringify({
          paymentMode: edit.paymentMode || "",
          transactionRef: edit.transactionRef || "",
          chequeNo: edit.chequeNo || "",
          bankName: edit.bankName || "",
          upiId: edit.upiId || "",
          notes: edit.notes || "",
          date: edit.date,
        }),
      });
      setToast({ type: "success", message: "Payment updated" });
      setEdit(null);
      load();
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function reverse(row) {
    const reason = window.prompt(
      `Reverse ${row.transactionId} (${money(row.amount)})?\n\nThe original stays in the ledger flagged as reversed and a mirror entry cancels it. Reason:`,
      "",
    );
    if (reason === null) return;
    try {
      const res = await api(`/api/admin/payments/received/${row._id}`, {
        method: "POST",
        body: JSON.stringify({ action: "reverse", reason }),
      });
      setToast({ type: "success", message: res.warning || "Payment reversed" });
      load();
    } catch (err) {
      setToast({ type: "error", message: err.message });
    }
  }

  function exportCsv() {
    const head = ["Txn ID", "Date", "Flat", "Owner", "Amount", "Mode", "Interest", "Principal", "Advance", "Reversed", "Notes"];
    const lines = rows.map((r) => [
      r.transactionId, fmtDate(r.date),
      r.member ? `${r.member.wing || ""}${r.member.wing ? "-" : ""}${r.member.flatNo}` : "",
      r.member ? r.member.ownerName : "",
      r.amount, r.paymentMode || "",
      (r.breakdown && r.breakdown.interestCleared) || 0,
      (r.breakdown && r.breakdown.principalCleared) || 0,
      (r.breakdown && r.breakdown.advanceCredit) || 0,
      r.isReversed ? "YES" : "", (r.notes || "").replace(/"/g, "'"),
    ]);
    const csv = [head, ...lines].map((l) => l.map((c) => `"${c === undefined || c === null ? "" : c}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `payments-received-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Pending / outstanding tab (late-list is the authoritative list of
  // members whose oldest unpaid bill is past the payment deadline; see gap
  // note in report — it does not include members who are outstanding but
  // still within the payment window) ──
  const [pending, setPending] = useState(null);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingDone, setPendingDone] = useState(null);

  const loadPending = useCallback(async () => {
    setPendingLoading(true);
    try {
      const [late, done] = await Promise.all([
        api("/api/payments/late-list"),
        api("/api/payments/pending-done").catch(() => null),
      ]);
      setPending(late);
      setPendingDone(done);
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setPendingLoading(false);
    }
  }, []);

  useEffect(() => { if (tab === "pending") loadPending(); }, [tab, loadPending]);

  // ── Record-payment modal (ported CREATE flow from the old advanced
  // payments page — posts to the same /api/payments/record + mark-done
  // routes) ──
  const [recordOpen, setRecordOpen] = useState(false);
  const [members, setMembers] = useState(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [outstanding, setOutstanding] = useState(null);
  const [outstandingLoading, setOutstandingLoading] = useState(false);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("Cash");
  const [payDate, setPayDate] = useState(new Date().toISOString().split("T")[0]);
  const [chequeNo, setChequeNo] = useState("");
  const [bankName, setBankName] = useState("");
  const [upiId, setUpiId] = useState("");
  const [transactionRef, setTransactionRef] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [markingDone, setMarkingDone] = useState(false);

  function resetRecordForm() {
    setSelectedMemberId("");
    setOutstanding(null);
    setAmount("");
    setMode("Cash");
    setPayDate(new Date().toISOString().split("T")[0]);
    setChequeNo("");
    setBankName("");
    setUpiId("");
    setTransactionRef("");
    setNotes("");
  }

  function openRecordModal(prefillMemberId) {
    resetRecordForm();
    if (prefillMemberId) setSelectedMemberId(prefillMemberId);
    setRecordOpen(true);
    if (!members) {
      setMembersLoading(true);
      api("/api/members/list")
        .then((d) => setMembers(d.members || []))
        .catch((err) => setToast({ type: "error", message: err.message }))
        .finally(() => setMembersLoading(false));
    }
  }

  useEffect(() => {
    if (!recordOpen || !selectedMemberId) { setOutstanding(null); return; }
    let cancelled = false;
    setOutstandingLoading(true);
    api(`/api/payments/outstanding?memberId=${selectedMemberId}`)
      .then((d) => { if (!cancelled) setOutstanding(d); })
      .catch((err) => { if (!cancelled) setToast({ type: "error", message: err.message }); })
      .finally(() => { if (!cancelled) setOutstandingLoading(false); });
    return () => { cancelled = true; };
  }, [recordOpen, selectedMemberId]);

  const memberOptions = useMemo(() => (
    (members || [])
      .slice()
      .sort((a, b) => {
        const wingCompare = (a.wing || "").localeCompare(b.wing || "");
        if (wingCompare !== 0) return wingCompare;
        return (parseInt(a.roomNo) || 0) - (parseInt(b.roomNo) || 0);
      })
      .map((m) => ({
        value: m._id,
        label: `${m.wing || ""}-${m.roomNo} | ${m.ownerName} | ${m.areaSqFt} sq.ft`,
      }))
  ), [members]);

  const selectedMember = useMemo(
    () => (members || []).find((m) => m._id === selectedMemberId),
    [members, selectedMemberId],
  );

  function quickPay(pct) {
    if (outstanding?.totalOutstanding) {
      setAmount(String(Math.round((outstanding.totalOutstanding * pct) / 100)));
    }
  }

  async function submitPayment(e) {
    e.preventDefault();
    if (!selectedMemberId || !amount || parseFloat(amount) <= 0) {
      setToast({ type: "error", message: "Select a member and enter a valid amount" });
      return;
    }
    if (outstanding?.billPayFinalDate) {
      const finalDate = new Date(outstanding.billPayFinalDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (today > finalDate) {
        setToast({ type: "error", message: `Payment window closed on ${finalDate.toLocaleDateString("en-IN")}. Use the Pending tab to record late payments.` });
        return;
      }
    }
    setSubmitting(true);
    try {
      const res = await api("/api/payments/record", {
        method: "POST",
        body: JSON.stringify({
          memberId: selectedMemberId,
          amount: parseFloat(amount),
          paymentMode: mode,
          paymentDate: payDate,
          chequeNo: mode === "Cheque" ? chequeNo : undefined,
          bankName: mode === "Cheque" ? bankName : undefined,
          upiId: mode === "UPI" ? upiId : undefined,
          transactionRef: ["Online", "NEFT", "RTGS"].includes(mode) ? transactionRef : undefined,
          notes,
        }),
      });
      setToast({ type: "success", message: `Payment ${res?.transaction?.transactionId || ""} recorded` });
      setRecordOpen(false);
      resetRecordForm();
      if (tab === "received") load();
      if (tab === "pending") loadPending();
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  async function markDone() {
    if (!selectedMemberId || !amount || parseFloat(amount) <= 0) {
      setToast({ type: "error", message: "Select a member and enter a valid amount" });
      return;
    }
    setMarkingDone(true);
    try {
      await api("/api/payments/mark-done", {
        method: "POST",
        body: JSON.stringify({
          memberId: selectedMemberId,
          amount: parseFloat(amount),
          paymentMode: mode,
          paymentDate: payDate,
          notes,
        }),
      });
      setToast({ type: "success", message: "Marked as Payment Done (pending Excel confirmation)" });
      setRecordOpen(false);
      resetRecordForm();
      if (tab === "pending") loadPending();
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setMarkingDone(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Payments"
        subtitle="Record payments, review what's been received, and track members who are pending or overdue."
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={() => openRecordModal()}>+ Record payment</Button>
            {tab === "received" && <Button variant="ghost" onClick={exportCsv}>Export CSV</Button>}
            <Button variant="ghost" onClick={() => (tab === "received" ? load() : loadPending())}>Refresh</Button>
          </div>
        }
      />

      <div style={S.tabs}>
        <button style={S.tab(tab === "received")} onClick={() => setTab("received")}>Received</button>
        <button style={S.tab(tab === "pending")} onClick={() => setTab("pending")}>Pending / Outstanding</button>
      </div>

      {tab === "received" && (
        <>
          <div style={{ ...grid(190), marginBottom: 18 }}>
            <StatCard label="Payments" value={summary.count} color={tokens.primary} />
            <StatCard label="Total received" value={money(summary.amount)} color="#16a34a" />
            <StatCard label="Interest cleared" value={money(summary.interest)} color="#d97706" />
            <StatCard label="Principal cleared" value={money(summary.principal)} color="#2563eb" />
            <StatCard label="Advance credit" value={money(summary.advance)} color="#7c3aed" />
          </div>

          <Card>
            <div style={S.filters}>
              <div style={S.fl}>
                <span style={S.lbl}>From</span>
                <input type="date" style={S.inp} value={filters.from}
                  onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, from: e.target.value })); }} />
              </div>
              <div style={S.fl}>
                <span style={S.lbl}>To</span>
                <input type="date" style={S.inp} value={filters.to}
                  onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, to: e.target.value })); }} />
              </div>
              <div style={S.fl}>
                <span style={S.lbl}>Mode</span>
                <select style={S.inp} value={filters.paymentMode}
                  onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, paymentMode: e.target.value })); }}>
                  {MODES.map((m) => <option key={m} value={m}>{m || "All modes"}</option>)}
                </select>
              </div>
              <label style={{ ...S.lbl, display: "flex", gap: 6, alignItems: "center", paddingBottom: 8 }}>
                <input type="checkbox" checked={filters.includeReversed}
                  onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, includeReversed: e.target.checked })); }} />
                Show reversed
              </label>
              <div style={S.fl}>
                <span style={S.lbl}>Search</span>
                <input style={{ ...S.inp, minWidth: 220 }} value={q} onChange={(e) => setQ(e.target.value)}
                  placeholder="Txn id, flat, owner, ref..." />
              </div>
              <Button variant="ghost" onClick={() => { setQ(""); setPage(1); setFilters(EMPTY_FILTERS); }}>Clear</Button>
            </div>

            {loading ? (
              <div style={S.center}><Spinner /></div>
            ) : rows.length === 0 ? (
              <EmptyState title="No payments" subtitle="Nothing matches these filters." />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Txn</th>
                      <th style={S.th}>Date</th>
                      <th style={S.th}>Flat / owner</th>
                      <th style={{ ...S.th, ...S.num }}>Amount</th>
                      <th style={S.th}>Mode</th>
                      <th style={S.th}>Allocation</th>
                      <th style={S.th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const b = r.breakdown || {};
                      return (
                        <tr key={r._id} style={r.isReversed ? { opacity: 0.55 } : undefined}>
                          <td style={S.td}>
                            <div style={{ fontWeight: 700 }}>{r.transactionId}</div>
                            {r.isReversed && <Badge color="#991b1b">Reversed</Badge>}
                            {r.billPeriodId && <div style={S.sub}>{r.billPeriodId}</div>}
                          </td>
                          <td style={S.td}>{fmtDate(r.date)}</td>
                          <td style={S.td}>
                            <div style={{ fontWeight: 600 }}>
                              {r.member ? `${r.member.wing ? `${r.member.wing}-` : ""}${r.member.flatNo || DASH}` : DASH}
                            </div>
                            <div style={S.sub}>{r.member ? r.member.ownerName : ""}</div>
                          </td>
                          <td style={{ ...S.td, ...S.num, fontWeight: 800 }}>{money(r.amount)}</td>
                          <td style={S.td}>
                            <div>{r.paymentMode || DASH}</div>
                            {(r.transactionRef || r.chequeNo) && (
                              <div style={S.sub}>{r.chequeNo || r.transactionRef}</div>
                            )}
                          </td>
                          <td style={S.td}>
                            <div style={S.sub}>Interest {money(b.interestCleared)}</div>
                            <div style={S.sub}>Principal {money(b.principalCleared)}</div>
                            {b.advanceCredit ? <div style={{ ...S.sub, color: "#7c3aed", fontWeight: 700 }}>Advance {money(b.advanceCredit)}</div> : null}
                          </td>
                          <td style={S.td}>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <Button size="sm" variant="ghost" disabled={r.isReversed}
                                onClick={() => setEdit({ ...r, date: r.date ? String(r.date).slice(0, 10) : "" })}>Edit</Button>
                              <Button size="sm" variant="ghost" disabled={r.isReversed} onClick={() => reverse(r)}>Reverse</Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {data && data.pages > 1 && (
              <div style={S.pager}>
                <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <span style={S.sub}>Page {data.page} of {data.pages}</span>
                <Button size="sm" variant="ghost" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            )}
          </Card>
        </>
      )}

      {tab === "pending" && (
        <>
          {pendingDone?.bills?.length > 0 && (
            <Card style={{ marginBottom: 18, borderLeft: "4px solid #F59E0B" }}>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>
                Payment Done — awaiting Excel confirmation ({pendingDone.bills.length})
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Flat</th>
                      <th style={S.th}>Member</th>
                      <th style={S.th}>Period</th>
                      <th style={{ ...S.th, ...S.num }}>Amount</th>
                      <th style={S.th}>Mode</th>
                      <th style={S.th}>Date</th>
                      <th style={S.th}>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingDone.bills.map((b) => (
                      <tr key={b.billId}>
                        <td style={S.td}>{b.flat}</td>
                        <td style={S.td}>{b.memberName}</td>
                        <td style={S.td}>{b.billPeriodId}</td>
                        <td style={{ ...S.td, ...S.num, fontWeight: 700 }}>{money(b.amount)}</td>
                        <td style={S.td}>{b.paymentMode}</td>
                        <td style={S.td}>{fmtDate(b.paymentDate)}</td>
                        <td style={{ ...S.td, ...S.sub }}>{b.notes || DASH}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ ...S.sub, marginTop: 10 }}>
                Acknowledged cash/manual payments. Upload the payment Excel to allocate them and mark the bills Paid.
              </div>
            </Card>
          )}

          <div style={{ ...grid(190), marginBottom: 18 }}>
            <StatCard label="Late members" value={pending?.totalMembers ?? 0} color={tokens.danger} />
            <StatCard label="Total due" value={money(pending?.totalDue)} color="#dc2626" />
            <StatCard label="Interest due" value={money(pending?.totalInterestDue)} color="#d97706" />
            <StatCard label="Principal due" value={money(pending?.totalPrincipalDue)} color="#2563eb" />
          </div>

          <Card>
            <div style={{ ...S.sub, marginBottom: 14 }}>
              Members whose oldest unpaid bill is past the payment deadline (payment window closed for them).
              Members with dues still inside the payment window are not listed here — see the "Received" tab
              totals or record a payment directly for any member via "+ Record payment".
            </div>
            {pendingLoading ? (
              <div style={S.center}><Spinner /></div>
            ) : !pending?.members?.length ? (
              <EmptyState icon="✅" title="No overdue members" subtitle="Nobody is past their payment deadline." />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Flat</th>
                      <th style={S.th}>Member</th>
                      <th style={S.th}>Oldest period</th>
                      <th style={S.th}>Deadline</th>
                      <th style={{ ...S.th, ...S.num }}>Principal</th>
                      <th style={{ ...S.th, ...S.num }}>Interest</th>
                      <th style={{ ...S.th, ...S.num }}>Total due</th>
                      <th style={S.th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.members.map((m) => (
                      <tr key={m.memberId}>
                        <td style={S.td}>{m.wing}-{m.flatNo}</td>
                        <td style={S.td}>{m.ownerName}</td>
                        <td style={S.td}>{m.oldestPeriod}</td>
                        <td style={{ ...S.td, color: "#dc2626", fontWeight: 700 }}>{fmtDate(m.deadline)}</td>
                        <td style={{ ...S.td, ...S.num }}>{money(m.principalOutstanding)}</td>
                        <td style={{ ...S.td, ...S.num, color: "#dc2626" }}>{money(m.interestOutstanding)}</td>
                        <td style={{ ...S.td, ...S.num, fontWeight: 800 }}>{money(m.totalOutstanding)}</td>
                        <td style={S.td}>
                          <Button size="sm" onClick={() => openRecordModal(m.memberId)}>Record payment</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {/* EDIT MODAL — metadata only, amount is intentionally immutable */}
      <Modal
        open={Boolean(edit)}
        title={edit ? `Edit ${edit.transactionId}` : ""}
        onClose={() => setEdit(null)}
        width={520}
        footer={
          <div style={{ display: "flex", gap: 8 }}>
            <Button disabled={saving} onClick={saveEdit}>{saving ? "Saving..." : "Save changes"}</Button>
            <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
          </div>
        }
      >
        {edit && (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ padding: 10, borderRadius: 8, background: "#f3f4f6", fontSize: 12.5, color: tokens.sub }}>
              Amount ({money(edit.amount)}) cannot be edited here - changing it would desynchronise
              bill allocation and receipts. Reverse this payment and record a corrected one instead.
            </div>
            <div style={S.fl}>
              <span style={S.lbl}>Value date</span>
              <input type="date" style={S.inp} value={edit.date || ""}
                onChange={(e) => setEdit((s) => ({ ...s, date: e.target.value }))} />
            </div>
            <div style={S.fl}>
              <span style={S.lbl}>Payment mode</span>
              <select style={S.inp} value={edit.paymentMode || ""}
                onChange={(e) => setEdit((s) => ({ ...s, paymentMode: e.target.value }))}>
                {MODES.filter(Boolean).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div style={S.fl}>
              <span style={S.lbl}>Reference / UTR</span>
              <input style={S.inp} value={edit.transactionRef || ""}
                onChange={(e) => setEdit((s) => ({ ...s, transactionRef: e.target.value }))} />
            </div>
            <div style={S.fl}>
              <span style={S.lbl}>Cheque no.</span>
              <input style={S.inp} value={edit.chequeNo || ""}
                onChange={(e) => setEdit((s) => ({ ...s, chequeNo: e.target.value }))} />
            </div>
            <div style={S.fl}>
              <span style={S.lbl}>Bank</span>
              <input style={S.inp} value={edit.bankName || ""}
                onChange={(e) => setEdit((s) => ({ ...s, bankName: e.target.value }))} />
            </div>
            <div style={S.fl}>
              <span style={S.lbl}>UPI id</span>
              <input style={S.inp} value={edit.upiId || ""}
                onChange={(e) => setEdit((s) => ({ ...s, upiId: e.target.value }))} />
            </div>
            <div style={S.fl}>
              <span style={S.lbl}>Notes</span>
              <textarea rows={3} style={S.inp} value={edit.notes || ""}
                onChange={(e) => setEdit((s) => ({ ...s, notes: e.target.value }))} />
            </div>
          </div>
        )}
      </Modal>

      {/* RECORD PAYMENT MODAL — ported CREATE flow */}
      <Modal
        open={recordOpen}
        title="Record a payment"
        onClose={() => { setRecordOpen(false); resetRecordForm(); }}
        width={640}
        footer={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button
              variant="subtle"
              disabled={!selectedMemberId || !amount || markingDone}
              onClick={markDone}
            >
              {markingDone ? "Marking..." : "Mark done (cash, confirm via Excel)"}
            </Button>
            <Button
              disabled={!selectedMemberId || !amount || submitting}
              onClick={submitPayment}
            >
              {submitting ? "Recording..." : "Record payment"}
            </Button>
            <Button variant="ghost" onClick={() => { setRecordOpen(false); resetRecordForm(); }}>Cancel</Button>
          </div>
        }
      >
        <form onSubmit={submitPayment} style={{ display: "grid", gap: 14 }}>
          <Field label="Member" required>
            <RSelect
              options={memberOptions}
              value={memberOptions.find((o) => o.value === selectedMemberId) || null}
              onChange={(opt) => setSelectedMemberId(opt?.value || "")}
              placeholder={membersLoading ? "Loading members..." : "Search by room, name or wing..."}
              isClearable
              isSearchable
              isLoading={membersLoading}
              styles={{ menu: (base) => ({ ...base, zIndex: 9999 }) }}
            />
          </Field>

          {outstandingLoading && (
            <div style={{ ...S.center, padding: 16 }}><Spinner size={18} /></div>
          )}

          {outstanding && (
            <Card pad={14} style={{ background: outstanding.isPaymentBlocked ? "#FEF2F2" : "#F0F9FF" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{selectedMember?.wing}-{selectedMember?.roomNo}</div>
                  <div style={S.sub}>{selectedMember?.ownerName}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={S.sub}>Total outstanding</div>
                  <div style={{ fontWeight: 800, fontSize: 18, color: "#dc2626" }}>{money(outstanding.totalOutstanding)}</div>
                </div>
              </div>
              <div style={S.sub}>Principal {money(outstanding.principalAmount)} · Interest {money(outstanding.interestAmount)}</div>
              {outstanding.isPaymentBlocked && (
                <div style={{ marginTop: 8, fontSize: 12.5, color: "#991b1b", fontWeight: 600 }}>
                  {outstanding.blockMessage || "Payment window closed for this member."}
                </div>
              )}
              {outstanding.totalOutstanding > 0 && (
                <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                  {[25, 50, 75, 100].map((pct) => (
                    <Button key={pct} type="button" size="sm" variant="subtle" onClick={() => quickPay(pct)}>
                      {pct}% ({money((outstanding.totalOutstanding * pct) / 100)})
                    </Button>
                  ))}
                </div>
              )}
            </Card>
          )}

          <Field label="Payment amount (Rs)" required>
            <Input type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Enter amount" />
          </Field>

          <Field label="Payment mode" required>
            <Select value={mode} onChange={(e) => setMode(e.target.value)}>
              {RECORD_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </Field>

          {mode === "Cheque" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Cheque no."><Input value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} /></Field>
              <Field label="Bank"><Input value={bankName} onChange={(e) => setBankName(e.target.value)} /></Field>
            </div>
          )}
          {mode === "UPI" && (
            <Field label="UPI id"><Input value={upiId} onChange={(e) => setUpiId(e.target.value)} /></Field>
          )}
          {["Online", "NEFT", "RTGS"].includes(mode) && (
            <Field label="Reference / UTR"><Input value={transactionRef} onChange={(e) => setTransactionRef(e.target.value)} /></Field>
          )}

          <Field label="Payment date" required>
            <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          </Field>

          <Field label="Notes">
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
          </Field>
        </form>
      </Modal>

      {toast ? <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} /> : null}
    </div>
  );
}

"use client";
import { useState, useEffect, useMemo } from "react";
import DOMPurify from "dompurify";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/ViewBills.module.css";
const STATUS_COLOR = {
  Paid: { bg: "#dcfce7", text: "#15803d", border: "#86efac" },
  Partial: { bg: "#fef9c3", text: "#92400e", border: "#fcd34d" },
  Unpaid: { bg: "#fee2e2", text: "#b91c1c", border: "#fca5a5" },
  Overdue: { bg: "#f3e8ff", text: "#7c3aed", border: "#c4b5fd" },
  Scheduled: { bg: "#f1f5f9", text: "#475569", border: "#cbd5e1" },
};
function fmt(n) {
  return Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function chargesTotal(bill) {
  // Current-month charges ONLY. Prefer the per-head charge map (exactly what the
  // Charge Breakdown table renders) and the Ledger V2 canonical currentCharges.
  // currentBillTotal / subtotal are legacy and on some rows were stored as the
  // grand total (incl. carry-forward), which made "Current Bill" and
  // "Current Month Total" show ₹3,580 instead of ₹2,362.50.
  if (bill.charges && typeof bill.charges === "object") {
    const keys = Object.keys(bill.charges);
    if (keys.length) {
      return Object.values(bill.charges).reduce((s, v) => s + Number(v || 0), 0);
    }
  }
  if (bill.currentCharges != null) return bill.currentCharges;
  if (bill.currentBillTotal != null) return bill.currentBillTotal;
  if (bill.subtotal != null) return bill.subtotal;
  return 0;
}
function prevBalance(bill) {
  // Previous *principal* carried in, DERIVED so the summary cards always
  // reconcile:  Total Due = Current Bill + Prev Balance + Interest.
  // (openingPrincipal isn't returned by the bills-list API, which made this
  // show "Clear" even when ₹1,000 was carried forward.)
  const v =
    Number(bill.totalAmount || 0) - chargesTotal(bill) - Number(bill.interestAmount || 0);
  return Math.max(0, parseFloat(v.toFixed(2)));
}
function flatLabel(member) {
  const wing = String(member?.wing || "").trim();
  const flat = String(member?.flatNo || "").trim();
  if (!wing) return flat;
  // flatNo sometimes already carries the wing (e.g. "A-101"), which produced
  // the doubled "A-A-101". Don't prepend the wing again in that case.
  if (flat.toUpperCase().startsWith(wing.toUpperCase())) return flat;
  return `${wing}-${flat}`;
}
function interestParts(bill) {
  // Split the interest line so the summary is transparent AND reconciles:
  //   carried   = interest brought forward from prior unpaid months (openingInterest)
  //   thisMonth = interest accrued on this bill (currentInterest)
  // Falls back to deriving from interestAmount for older bills missing the split.
  const round = (n) => parseFloat((Number(n) || 0).toFixed(2));
  const total = round(bill.interestAmount);
  const thisMonth =
    bill.currentInterest != null
      ? round(bill.currentInterest)
      : Math.max(0, round(total - (bill.openingInterest || 0)));
  const carried =
    bill.openingInterest != null
      ? round(bill.openingInterest)
      : Math.max(0, round(total - thisMonth));
  return { carried, thisMonth, total };
}
function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function BillPdfTab({ bill }) {
  // Always fetch from the server so the CURRENT saved template is applied
  // (the server re-renders live for non-locked bills). Stored billHtml is only
  // used as an offline fallback if the request fails.
  //
  // /api/bills/download returns text/html for the default renderer but a raw
  // application/pdf whenever the society has a custom uploaded PDF/image bill
  // template configured (see Case 1/1b in that route) — previously this tab
  // only knew how to inline HTML and threw on the PDF response, always
  // showing the "use Print button" placeholder for any society running a
  // custom template. A PDF blob renders fine in an <iframe>, so branch on
  // content-type instead of assuming HTML.
  const [html, setHtml] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    setLoading(true);
    setPdfUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    fetch(`/api/bills/download?id=${bill._id}`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load bill");
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("text/html")) return { kind: "html", value: await res.text() };
        if (ct.includes("application/pdf")) return { kind: "pdf", value: await res.blob() };
        throw new Error("Unrecognized bill content — use Print button to download");
      })
      .then((result) => {
        if (result.kind === "html") { setHtml(result.value); setLoading(false); return; }
        setPdfUrl(URL.createObjectURL(result.value));
        setLoading(false);
      })
      .catch((e) => {
        if (bill.billHtml) { setHtml(bill.billHtml); setLoading(false); return; }
        setError(e.message); setLoading(false);
      });
    return () => setPdfUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return prev; });
  }, [bill._id]);
  // Must run unconditionally, before any early return below - a hook called
  // only on some renders (e.g. skipped while `loading` is true on first
  // render, then reached once `html` resolves) violates the Rules of Hooks
  // and crashes with "Rendered more hooks than during the previous render."
  const safeHtml = useMemo(
    () => (html && typeof window !== "undefined" ? DOMPurify.sanitize(html) : ""),
    [html],
  );
  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "#6b7280" }}>Loading bill...</div>;
  if (error) return (
    <div style={{ padding: 40, textAlign: "center" }}>
      <div style={{ fontSize: 32 }}>📄</div>
      <p style={{ color: "#6b7280", marginTop: 8 }}>{error}</p>
    </div>
  );
  if (pdfUrl) return (
    <iframe src={pdfUrl} title="Bill PDF" style={{ width: "100%", height: "80vh", border: "none" }} />
  );
  if (!html) return (
    <div style={{ padding: 60, textAlign: "center" }}>
      <div style={{ fontSize: 32 }}>📄</div>
      <p style={{ color: "#6b7280", marginTop: 8 }}>No bill content. Click Print to regenerate.</p>
    </div>
  );
  return (
    <div style={{ maxWidth: 800, margin: "0 auto" }}>
      <div dangerouslySetInnerHTML={{ __html: safeHtml }} />
    </div>
  );
}
export default function ViewBillsPage() {
  const [selectedPeriod, setSelectedPeriod] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [viewingBill, setViewingBill] = useState(null);
  const [activeTab, setActiveTab] = useState("summary");
  const [downloadingId, setDownloadingId] = useState(null);
  const [seriesFilter, setSeriesFilter] = useState("All"); // "All" | "Residential" | "Commercial"
  const { data: billsData, isLoading } = useQuery({
    queryKey: ["view-bills", selectedPeriod, filterStatus],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedPeriod !== "all") params.append("period", selectedPeriod);
      if (filterStatus !== "all") params.append("status", filterStatus);
      const qs = params.toString();
      return apiClient.get(`/api/billing/generated${qs ? "?" + qs : ""}`);
    },
  });
  const { data: receiptsData, isLoading: receiptsLoading } = useQuery({
    queryKey: ["bill-receipts", viewingBill?.memberId?._id],
    queryFn: () => apiClient.get(`/api/receipts?memberId=${viewingBill.memberId._id}`),
    enabled: !!viewingBill?.memberId?._id && activeTab === "receipts",
  });
  const bills = billsData?.bills || [];
  const periods = [...new Set(bills.map((b) => b.billPeriodId))].filter(Boolean).sort().reverse();
  const filteredBills = bills.filter((b) => {
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      b.memberId?.flatNo?.toLowerCase().includes(q) ||
      b.memberId?.ownerName?.toLowerCase().includes(q) ||
      b.memberId?.wing?.toLowerCase().includes(q);
    const matchesSeries =
      seriesFilter === "All" || (b.billSeries || "RESIDENTIAL") === seriesFilter.toUpperCase();
    return matchesSearch && matchesSeries;
  });
  const openBill = (bill) => { setViewingBill(bill); setActiveTab("summary"); };
  const downloadBill = async (bill) => {
    setDownloadingId(bill._id?.toString());
    try {
      let html = bill.billHtml;
      if (!html) {
        const res = await fetch(`/api/bills/download?id=${bill._id}`, { credentials: "include" });
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("text/html")) {
          html = await res.text();
        } else {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = Object.assign(document.createElement("a"), { href: url, download: `Bill-${bill.memberId?.wing}-${bill.memberId?.flatNo}-${bill.billPeriodId}.pdf` });
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(url);
          return;
        }
      }
      if (!html) { alert("No bill data. Please regenerate."); return; }
      const blob = new Blob([`<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>body{font-family:Arial,sans-serif;padding:20px;}@media print{body{padding:0;}@page{margin:8mm;size:A4;}}</style></head><body>${html}<script>window.onload=function(){setTimeout(function(){window.print();},400);}<\/script></body></html>`], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank");
      if (!w) alert("Popup blocked. Please allow popups for this site.");
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      alert("Download failed: " + e.message);
    } finally {
      setDownloadingId(null);
    }
  };
  const exportToExcel = async () => {
    try {
      const res = await fetch("/api/billing/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ period: selectedPeriod !== "all" ? selectedPeriod : null }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: `Bills-${selectedPeriod}.xlsx` });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { alert("Export failed"); }
  };
  const sc = viewingBill ? (STATUS_COLOR[viewingBill.status] || STATUS_COLOR.Scheduled) : null;
  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1>View Bills</h1>
          <p>{filteredBills.length} bill{filteredBills.length !== 1 ? "s" : ""}{selectedPeriod !== "all" ? ` · ${selectedPeriod}` : " · all periods"}</p>
        </div>
        <div className={styles.headerActions}>
          <button onClick={exportToExcel} className="btn btn-secondary">Export Excel</button>
        </div>
      </div>
      {/* Filters */}
      <div className={styles.filtersCard}>
        <div className={styles.filterRow}>
          <div className={styles.searchBox}>
            <input type="text" placeholder="Search flat, name, wing..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className={styles.searchInput} />
          </div>
          <select value={selectedPeriod} onChange={(e) => setSelectedPeriod(e.target.value)} className={styles.select}>
            <option value="all">All Periods</option>
            {periods.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={styles.select}>
            <option value="all">All Status</option>
            <option value="Paid">Paid</option>
            <option value="Partial">Partial</option>
            <option value="Unpaid">Unpaid</option>
            <option value="Overdue">Overdue</option>
          </select>
          <select value={seriesFilter} onChange={(e) => setSeriesFilter(e.target.value)} className={styles.select}>
            <option value="All">All (Residential + Commercial)</option>
            <option value="Residential">Residential</option>
            <option value="Commercial">Commercial</option>
          </select>
          <div className={styles.resultCount}>{filteredBills.length} Bills</div>
        </div>
      </div>
      {/* Table */}
      {isLoading ? (
        <div className={styles.loading}><div className={styles.spinner} /><p>Loading bills...</p></div>
      ) : filteredBills.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>📭</div>
          <h3>No bills found</h3>
          <p>Adjust filters or generate bills first</p>
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.billsTable}>
            <thead>
              <tr>
                <th>Flat</th>
                <th>Member</th>
                <th>Unit Class</th>
                <th>Period</th>
                <th>Current Bill</th>
                <th>Prev Balance</th>
                <th>Interest</th>
                <th>Total Due</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Due Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredBills.map((bill) => {
                const colors = STATUS_COLOR[bill.status] || STATUS_COLOR.Scheduled;
                const isHistorical = bill.isHistoricalArchive || bill.importedFrom === "BulkImport" || bill.isLocked;
                return (
                  <tr key={bill._id} className={styles.billRow}
                    style={isHistorical ? { background: "#fafaf7", opacity: 0.92 } : {}}
                    onClick={() => openBill(bill)}>
                    <td>
<strong>{flatLabel(bill.memberId)}</strong>                      {isHistorical && (
                        <span title="Historical imported record — immutable" style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, background: "#e0e7ff", color: "#3730a3", borderRadius: 4, padding: "1px 5px", border: "1px solid #c7d2fe", verticalAlign: "middle" }}>
                          HIST
                        </span>
                      )}
                    </td>
                    <td>{bill.memberId?.ownerName}</td>
                    <td>{bill.unitClass ?? "—"}</td>
                    <td><span className={styles.periodTag}>{bill.billPeriodId}</span></td>
                    <td>₹{fmt(chargesTotal(bill))}</td>
                  <td style={{ color: prevBalance(bill) > 0 ? "#b91c1c" : "#15803d" }}>
  {prevBalance(bill) > 0 ? `₹${fmt(prevBalance(bill))}` : "Clear"}
</td>
                    <td style={{ color: (bill.interestAmount || 0) > 0 ? "#92400e" : "#9ca3af" }}>
                      {(bill.interestAmount || 0) > 0 ? `₹${fmt(bill.interestAmount)}` : "—"}
                    </td>
                    <td><strong>₹{fmt(bill.totalAmount)}</strong></td>
                    <td style={{ color: "#15803d" }}>
                      {(bill.amountPaid || 0) > 0 ? `₹${fmt(bill.amountPaid)}` : "—"}
                    </td>
                    <td style={{ color: (bill.balanceAmount || 0) > 0 ? "#b91c1c" : "#15803d", fontWeight: 700 }}>
                      {(bill.balanceAmount || 0) > 0.005 ? `₹${fmt(bill.balanceAmount)}` : "Paid"}
                    </td>
                    <td>{fmtDate(bill.dueDate)}</td>
                    <td>
                      <span style={{ padding: "3px 10px", borderRadius: 12, fontSize: 12, fontWeight: 600, background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}>
                        {bill.status}
                      </span>
                      {isHistorical && <span title="Locked — immutable audit record" style={{ marginLeft: 4, fontSize: 13 }}>🔒</span>}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <button onClick={() => openBill(bill)} className={styles.actionBtn}>View</button>
                        <button onClick={() => downloadBill(bill)} className={styles.actionBtn} disabled={downloadingId === bill._id?.toString()}>
                          {downloadingId === bill._id?.toString() ? "..." : "Print"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {/* Modal */}
      {viewingBill && (
        <div className={styles.modal} onClick={() => setViewingBill(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className={styles.modalHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ background: "#4f46e5", color: "white", borderRadius: 10, padding: "8px 14px", fontWeight: 700, fontSize: 18, letterSpacing: 1 }}>
{flatLabel(viewingBill.memberId)}                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 18, color: "#111" }}>{viewingBill.memberId?.ownerName}</div>
                  <div style={{ color: "#6b7280", fontSize: 13 }}>
                    Period: {viewingBill.billPeriodId}
                    {viewingBill.importedFinancialYear && <> · FY: {viewingBill.importedFinancialYear}</>}
                    {!(viewingBill.isHistoricalArchive || viewingBill.importedFrom === "BulkImport") && <> · Generated: {fmtDate(viewingBill.generatedAt || viewingBill.createdAt)}</>}
                  </div>
                </div>
              </div>
              <button onClick={() => setViewingBill(null)} className={styles.closeBtn}>✕</button>
            </div>
            {/* Historical bill notice */}
            {(viewingBill.isHistoricalArchive || viewingBill.importedFrom === "BulkImport" || viewingBill.isLocked) && (
              <div style={{ margin: "0 2rem", padding: "10px 16px", background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 8, display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#3730a3" }}>
                <span>🔒</span>
                <span><strong>Historical Record</strong> — This bill was imported as an audit record and is immutable. It cannot be edited, deleted, or regenerated.</span>
              </div>
            )}
            {/* Tabs */}
            <div style={{ display: "flex", borderBottom: "2px solid #e5e7eb", padding: "0 2rem" }}>
              {[["summary", "Summary"], ["bill", "Bill PDF"], ["receipts", "Receipts"]].map(([tab, label]) => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: "12px 20px", border: "none", background: "none", cursor: "pointer", fontWeight: activeTab === tab ? 700 : 400, color: activeTab === tab ? "#4f46e5" : "#6b7280", borderBottom: activeTab === tab ? "3px solid #4f46e5" : "3px solid transparent", marginBottom: -2, fontSize: 14 }}>
                  {label}
                </button>
              ))}
            </div>
            <div className={styles.modalBody}>
              {/* SUMMARY TAB */}
              {activeTab === "summary" && (
                <div>
                  {/* Status + due date */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: sc.bg, border: `1px solid ${sc.border}`, borderRadius: 10, padding: "12px 18px", marginBottom: 20 }}>
                    <span style={{ fontWeight: 700, color: sc.text, fontSize: 15 }}>{viewingBill.status}</span>
                    <span style={{ color: "#6b7280", fontSize: 13 }}>Due: {fmtDate(viewingBill.dueDate)}</span>
                  </div>
                  {/* Amount cards */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 24 }}>
                    {[
                      { label: "Current Bill", value: `₹${fmt(chargesTotal(viewingBill))}`, color: "#1f2937" },
                      // Prev Balance = previous *principal* only. Carried-forward
// interest is already shown in the separate "Interest" cards,
// so using previousBalance (principal + interest) here
// double-counted the ₹200 and broke parts → total.
                      { label: "Prev Balance", value: prevBalance(viewingBill) > 0 ? `₹${fmt(prevBalance(viewingBill))}` : "Clear", color: prevBalance(viewingBill) > 0 ? "#b91c1c" : "#15803d" },
                      { label: "Interest (carried)", value: interestParts(viewingBill).carried > 0 ? `₹${fmt(interestParts(viewingBill).carried)}` : "—", color: interestParts(viewingBill).carried > 0 ? "#92400e" : "#9ca3af" },
                      { label: "Interest (this month)", value: interestParts(viewingBill).thisMonth > 0 ? `₹${fmt(interestParts(viewingBill).thisMonth)}` : "—", color: interestParts(viewingBill).thisMonth > 0 ? "#92400e" : "#9ca3af" },
                      { label: "Total Due", value: `₹${fmt(viewingBill.totalAmount)}`, color: "#4f46e5", large: true },
                      ...(viewingBill.amountPaid > 0 ? [{ label: "Paid", value: `₹${fmt(viewingBill.amountPaid)}`, color: "#15803d" }] : []),
                      ...((viewingBill.balanceAmount || 0) > 0.005 ? [{ label: "Balance Due", value: `₹${fmt(viewingBill.balanceAmount)}`, color: "#b91c1c", large: true }] : []),
                    ].map((c) => (
                      <div key={c.label} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: "14px 16px", textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{c.label}</div>
                        <div style={{ fontSize: c.large ? 20 : 15, fontWeight: 700, color: c.color }}>{c.value}</div>
                      </div>
                    ))}
                  </div>
                  {/* Charges table */}
                  <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
                    <div style={{ padding: "12px 16px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb", fontWeight: 600, fontSize: 14 }}>Charge Breakdown</div>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <tbody>
                        {viewingBill.charges && Object.entries(viewingBill.charges).map(([name, amt], i) => (
                          <tr key={name} style={{ borderBottom: "1px solid #f3f4f6" }}>
                            <td style={{ padding: "10px 16px", color: "#6b7280", width: 32 }}>{i + 1}</td>
                            <td style={{ padding: "10px 16px" }}>{name}</td>
                            <td style={{ padding: "10px 16px", textAlign: "right", fontWeight: 600 }}>₹{fmt(amt)}</td>
                          </tr>
                        ))}
                        <tr style={{ background: "#f0fdf4" }}>
                          <td colSpan={2} style={{ padding: "12px 16px", fontWeight: 700 }}>Current Month Total</td>
                          <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "#15803d" }}>₹{fmt(chargesTotal(viewingBill))}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {/* BILL PDF TAB */}
              {activeTab === "bill" && (
                <BillPdfTab bill={viewingBill} />
              )}
              {/* RECEIPTS TAB */}
              {activeTab === "receipts" && (
                <div>
                  {receiptsLoading ? (
                    <div className={styles.loading}><div className={styles.spinner} /><p>Loading receipts...</p></div>
                  ) : receiptsData?.receipts?.length > 0 ? (
                    <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
                      <div style={{ padding: "12px 16px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb", fontWeight: 600, fontSize: 14 }}>
                        {receiptsData.receipts.length} Payment{receiptsData.receipts.length !== 1 ? "s" : ""} — {viewingBill.memberId?.ownerName}
                      </div>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: "#f9fafb" }}>
                            <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Receipt No</th>
                            <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Period</th>
                            <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Date</th>
                            <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Amount</th>
                            <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Mode</th>
                            <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {receiptsData.receipts.map((r) => (
                            <tr key={r._id} style={{ borderTop: "1px solid #f3f4f6" }}>
                              <td style={{ padding: "12px 16px", fontFamily: "monospace", fontSize: 13, color: "#4f46e5" }}>{r.receiptNo}</td>
                              <td style={{ padding: "12px 16px", fontSize: 13 }}>{r.billPeriodId || "—"}</td>
                              <td style={{ padding: "12px 16px", fontSize: 13 }}>{fmtDate(r.paidAt || r.createdAt)}</td>
                              <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "#15803d" }}>₹{fmt(r.amount)}</td>
                              <td style={{ padding: "12px 16px", fontSize: 13 }}>{r.paymentMode}</td>
                              <td style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280" }}>{r.notes || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className={styles.emptyState} style={{ padding: 60 }}>
                      <div className={styles.emptyIcon}>🧾</div>
                      <h3>No payments recorded</h3>
                      <p>No receipts for this bill yet</p>
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* Modal Footer */}
            <div className={styles.modalFooter}>
              <button onClick={() => setViewingBill(null)} className="btn btn-secondary">Close</button>
              <button onClick={() => downloadBill(viewingBill)} className="btn btn-primary" disabled={downloadingId === viewingBill._id?.toString()}>
                {downloadingId === viewingBill._id?.toString() ? "Opening..." : "Print / Download Bill"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
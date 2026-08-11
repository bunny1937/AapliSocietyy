"use client";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
async function fetchBalanceSheet(fy) {
  const res = await fetch(`/api/billing/balance-sheet?fy=${fy}`, { credentials: "include" });
  if (!res.ok) throw new Error((await res.json()).error || "Failed");
  return res.json();
}
const currentFY = () => {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
};
const fmt = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : "0.0");
const pctStr = (n, d) => pct(n, d) + "%";
const ENTRY_TYPES = ["Maintenance", "Sinking Fund", "Repair & Maintenance", "Other Income", "Other Expense", "Auditor Fees", "Legal Fees", "Utilities", "Custom"];
const S = {
  page: { padding: 0, maxWidth: 1500, margin: "0 auto", color: "#1e293b" },
  heading: { fontSize: "1.5rem", fontWeight: 800, margin: 0, color: "#0f172a" },
  sub: { color: "#64748b", fontSize: "0.85rem", marginTop: 4, margin: 0 },
  select: { padding: "0.5rem 0.75rem", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", color: "#1e293b", fontSize: "0.88rem" },
  sectionTitle: { fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#94a3b8", marginBottom: "0.75rem" },
  card: (accent, bg = "#fff") => ({ background: bg, border: `1px solid ${accent}30`, borderTop: `3px solid ${accent}`, borderRadius: 10, padding: "1rem 1.25rem" }),
  cardLabel: { color: "#64748b", fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 },
  cardValue: (color) => ({ color, fontSize: "1.45rem", fontWeight: 800, lineHeight: 1.2 }),
  cardSub: { color: "#94a3b8", fontSize: "0.7rem", marginTop: 3 },
  panel: (border, bg) => ({ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: "1.25rem" }),
  panelHead: (color) => ({ margin: "0 0 0.75rem", fontSize: "0.95rem", fontWeight: 700, color }),
  divRow: (border) => ({ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: `1px solid ${border}`, fontSize: "0.83rem" }),
  badge: (color, bg) => ({ display: "inline-block", padding: "2px 8px", borderRadius: 20, fontSize: "0.68rem", fontWeight: 700, color, background: bg }),
  th: { padding: "8px 12px", textAlign: "left", color: "#475569", fontWeight: 700, borderBottom: "2px solid #e2e8f0", background: "#f8fafc", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" },
  td: { padding: "9px 12px", borderBottom: "1px solid #f1f5f9", fontSize: "0.82rem", verticalAlign: "middle" },
  input: { width: "100%", padding: "0.5rem 0.7rem", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", color: "#1e293b", fontSize: "0.85rem", boxSizing: "border-box" },
};
function collectionColor(pctVal) {
  const v = parseFloat(pctVal);
  if (v >= 90) return "#16a34a";
  if (v >= 70) return "#2563eb";
  if (v >= 40) return "#d97706";
  return "#dc2626";
}
function collectionBg(pctVal) {
  const v = parseFloat(pctVal);
  if (v >= 90) return "#dcfce7";
  if (v >= 70) return "#dbeafe";
  if (v >= 40) return "#fef3c7";
  return "#fee2e2";
}
function StatusBadge({ row }) {
  if (row.isOpeningMonth) return <span style={S.badge("#7c3aed", "#ede9fe")}>Pre-Start</span>;
  if (!row.generated) return <span style={S.badge("#94a3b8", "#f1f5f9")}>Not Generated</span>;
  if (row.allPaid) return <span style={S.badge("#16a34a", "#dcfce7")}>✓ Fully Paid</span>;
  if (row.partial) return <span style={S.badge("#d97706", "#fef3c7")}>Partial</span>;
  return <span style={S.badge("#dc2626", "#fee2e2")}>Unpaid</span>;
}
function OpeningSnapshot({ firstGen, timeline }) {
  const seedPrincipal = firstGen?.openingPrincipal || 0;
  const seedInterest = firstGen?.openingInterest || 0;
  const seedTotal = seedPrincipal + seedInterest;
  const isMidYear = timeline.some((m) => m.isOpeningMonth);
  return (
    <div style={{ background: "#faf5ff", border: "1px solid #e9d5ff", borderLeft: "4px solid #7c3aed", borderRadius: 10, padding: "1.25rem 1.5rem", marginBottom: "1.5rem" }}>
      <div style={{ fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#7c3aed", marginBottom: 8 }}>
        Financial Year Opening Snapshot
      </div>
      <div style={{ fontSize: "0.78rem", color: "#6d28d9", marginBottom: "1rem" }}>
        As of 01 Apr {firstGen?.year || "—"}
        {isMidYear && <span style={{ marginLeft: 8, fontSize: "0.7rem", background: "#ede9fe", color: "#7c3aed", padding: "2px 8px", borderRadius: 4, fontWeight: 700 }}>Society joined mid-FY — billing started from {firstGen?.label}</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", maxWidth: 520 }}>
        {[
          { label: "Opening Principal Arrears", val: seedPrincipal, color: "#6d28d9" },
          { label: "Opening Interest Arrears", val: seedInterest, color: "#7c3aed" },
          { label: "Total Opening Balance", val: seedTotal, color: "#4c1d95", bold: true },
        ].map((r) => (
          <div key={r.label} style={{ background: "#fff", border: "1px solid #e9d5ff", borderRadius: 8, padding: "0.75rem 1rem" }}>
            <div style={{ fontSize: "0.65rem", color: "#a78bfa", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>{r.label}</div>
            <div style={{ fontSize: r.bold ? "1.1rem" : "1rem", fontWeight: r.bold ? 800 : 700, color: r.color }}>{fmt(r.val)}</div>
          </div>
        ))}
      </div>
      {seedTotal === 0 && (
        <div style={{ marginTop: "0.75rem", display: "inline-flex", alignItems: "center", gap: 6, background: "#dcfce7", border: "1px solid #bbf7d0", borderRadius: 6, padding: "4px 12px", fontSize: "0.75rem", color: "#16a34a", fontWeight: 700 }}>
          ✓ Fresh Financial Year — All Members Started with ₹0 Balance
        </div>
      )}
    </div>
  );
}
function ArrearsTrend({ prev, curr }) {
  if (prev === null || prev === undefined) return null;
  const delta = Math.abs(curr - prev);
  const deltaStr = delta > 0.005 ? ` by ${fmt(delta)}` : "";
  if (curr === 0 && prev === 0) return <span style={{ color: "#16a34a", fontSize: "0.7rem", fontWeight: 700 }}>✓ Cleared</span>;
  if (curr === 0 && prev > 0) return <span style={{ color: "#16a34a", fontSize: "0.7rem", fontWeight: 700 }}>✓ Cleared{deltaStr}</span>;
  if (curr < prev) return <span style={{ color: "#16a34a", fontSize: "0.7rem", fontWeight: 700 }}>↓ Reduced{deltaStr}</span>;
  if (curr > prev) return <span style={{ color: "#dc2626", fontSize: "0.7rem", fontWeight: 700 }}>↑ Increased{deltaStr}</span>;
  return <span style={{ color: "#94a3b8", fontSize: "0.7rem" }}>→ Same</span>;
}
function FYClosingRow({ timeline, summary }) {
  const totalBilled = timeline.reduce((s, r) => s + (r.totalBilled || 0), 0);
  const totalCollected = timeline.reduce((s, r) => s + (r.totalPaid || 0), 0);
  const totalAdvance = timeline.reduce((s, r) => s + (r.totalAdvance || 0), 0);
  const totalInterest = timeline.reduce((s, r) => s + (r.totalInterest || 0), 0);
  // FY closing outstanding = last generated month's pending (state value, not additive sum)
  const genMonths = timeline.filter(r => r.generated);
  const lastGen = genMonths[genMonths.length - 1];
  const fyClosingOutstanding = lastGen?.totalPending ?? 0;
  const allClosed = genMonths.length > 0 && genMonths.every(r => r.allPaid);
  const label = fyClosingOutstanding > 0
    ? "⚠ FY Closed With Outstanding Dues"
    : genMonths.length > 0
      ? "✓ FY Closed Successfully — No Outstanding Dues"
      : "FY Summary";
  return (
    <tr style={{ background: allClosed ? "#f0fdf4" : "#fffbeb", borderTop: "3px solid " + (allClosed ? "#16a34a" : "#d97706") }}>
      <td colSpan={2} style={{ ...S.td, fontWeight: 800, color: allClosed ? "#16a34a" : "#d97706", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </td>
      <td style={{ ...S.td, color: "#64748b", fontWeight: 700 }}>{genMonths.length} months</td>
      <td style={S.td} />
      <td style={{ ...S.td, color: "#1d4ed8", fontWeight: 800 }}>{fmt(totalBilled)}</td>
      <td style={{ ...S.td, color: "#16a34a", fontWeight: 800 }}>{fmt(totalCollected)}</td>
      <td style={{ ...S.td, color: "#0891b2", fontWeight: 700 }}>{totalAdvance > 0 ? fmt(totalAdvance) : "—"}</td>
      <td style={{ ...S.td, color: fyClosingOutstanding > 0 ? "#dc2626" : "#16a34a", fontWeight: 800 }}>{fmt(fyClosingOutstanding)}</td>
      <td style={{ ...S.td, color: "#7c3aed", fontWeight: 700 }}>{fmt(totalInterest)}</td>
      <td colSpan={3} style={S.td} />
    </tr>
  );
}
function MonthTimeline({ timeline, summary }) {
  if (!timeline?.length) return null;
  const firstGen = timeline.find((m) => m.generated);
  const pendingByMonth = timeline.map(r => r.totalPending || 0);
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden", marginBottom: "2rem" }}>
      <div style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid #e2e8f0", background: "#f8fafc", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={S.sectionTitle}>Month-by-Month Billing Journey</div>
        <div style={{ display: "flex", gap: "1.5rem", fontSize: "0.7rem", color: "#64748b" }}>
          <span>Apr = FY start</span>
          <span>Mar = FY closing</span>
          <span style={{ color: "#7c3aed" }}>Principal + Interest tracked separately</span>
        </div>
      </div>
      {firstGen && <OpeningSnapshot firstGen={firstGen} timeline={timeline} />}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
          <thead>
            <tr>
              <th style={S.th}>Month</th>
              <th style={S.th}>Status</th>
              <th style={{ ...S.th, textAlign: "center" }}>Members<br />Cleared</th>
              <th style={S.th}>
                <div>Opening Balance</div>
                <div style={{ fontSize: "0.62rem", color: "#a78bfa", fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>Principal · Interest</div>
              </th>
              <th style={S.th}>Billed</th>
              <th style={S.th}>
                <div>Collected</div>
                <div style={{ fontSize: "0.62rem", color: "#86efac", fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>Cash received</div>
              </th>
              <th style={{ ...S.th }} title="Overpayment credit from a previous month automatically applied to reduce this month's due. Not a new cash payment.">
                <div>Advance Used ℹ</div>
                <div style={{ fontSize: "0.62rem", color: "#67e8f9", fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>Prev overpayment</div>
              </th>
              <th style={S.th}>
                <div>Pending</div>
                <div style={{ fontSize: "0.62rem", color: "#fca5a5", fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>Outstanding dues</div>
              </th>
              <th style={S.th}>
                <div>Interest Generated</div>
                <div style={{ fontSize: "0.62rem", color: "#c4b5fd", fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>Late payment charge</div>
              </th>
              <th style={S.th}>Sinking Fund</th>
              <th style={S.th}>Repair Fund</th>
              <th style={{ ...S.th, minWidth: 120 }}>Collection %</th>
            </tr>
          </thead>
          <tbody>
            {timeline.map((row, i) => {
              const isEven = i % 2 === 0;
              const bg = row.isOpeningMonth ? "#faf5ff"
                : row.isMarch ? (row.allPaid ? "#f0fdf4" : "#fffbeb")
                : (isEven ? "#fff" : "#f8fafc");
              const dash = <span style={{ color: "#e2e8f0" }}>—</span>;
              const prevPending = i > 0 ? pendingByMonth[i - 1] : null;
              const effectivePct = pct(row.totalPaid + row.totalAdvance, row.totalBilled);
              const openingCell = row.isOpeningMonth ? (
                <div style={{ fontSize: "0.75rem" }}>
                  <div style={{ color: "#7c3aed", fontWeight: 700 }}>{fmt((firstGen?.openingPrincipal || 0) + (firstGen?.openingInterest || 0))}</div>
                  <div style={{ color: "#a78bfa", fontSize: "0.68rem" }}>Principal: {fmt(firstGen?.openingPrincipal || 0)}</div>
                  <div style={{ color: "#a78bfa", fontSize: "0.68rem" }}>Interest: {fmt(firstGen?.openingInterest || 0)}</div>
                  <div style={{ color: "#c4b5fd", fontSize: "0.63rem", marginTop: 2 }}>carried forward →</div>
                </div>
              ) : row.generated && row.openingTotal > 0 ? (
                <div>
                  <div style={{ color: "#6d28d9", fontWeight: 700 }}>{fmt(row.openingTotal)}</div>
                  <div style={{ fontSize: "0.68rem", color: "#8b5cf6", marginTop: 2 }}>Principal: {fmt(row.openingPrincipal)}</div>
                  <div style={{ fontSize: "0.68rem", color: "#8b5cf6" }}>Interest: {fmt(row.openingInterest)}</div>
                </div>
              ) : row.generated ? (
                <span style={{ color: "#94a3b8", fontSize: "0.75rem" }}>₹0</span>
              ) : dash;
              return (
                <tr key={row.periodId} style={{ background: bg, borderBottom: "1px solid #f1f5f9" }}>
                  {/* Month */}
                  <td style={{ ...S.td, fontWeight: (row.isMarch || row.isOpeningMonth) ? 800 : 600, color: row.isOpeningMonth ? "#7c3aed" : row.isMarch ? "#d97706" : "#1e293b", whiteSpace: "nowrap" }}>
                    <div>{row.label}</div>
                    {row.isMarch && (
                      <div style={{ marginTop: 3, fontSize: "0.63rem", color: "#fff", background: "#d97706", padding: "1px 6px", borderRadius: 4, fontWeight: 700, display: "inline-block" }}>FY CLOSE</div>
                    )}
                    {row.isOpeningMonth && (
                      <div style={{ marginTop: 3, fontSize: "0.63rem", color: "#7c3aed", background: "#ede9fe", padding: "1px 6px", borderRadius: 4, fontWeight: 700, display: "inline-block" }}>PRE-START</div>
                    )}
                  </td>
                  {/* Status */}
                  <td style={S.td}><StatusBadge row={row} /></td>
                  {/* Members Cleared */}
                  <td style={{ ...S.td, textAlign: "center" }}>
                    {row.generated ? (
                      <div>
                        <div style={{ fontWeight: 700, color: row.allPaid ? "#16a34a" : "#1e293b" }}>{row.paidCount} / {row.billCount}</div>
                        <div style={{ fontSize: "0.65rem", color: "#94a3b8" }}>cleared</div>
                      </div>
                    ) : dash}
                  </td>
                  {/* Opening Balance */}
                  <td style={S.td}>{openingCell}</td>
                  {/* Billed */}
                  <td style={{ ...S.td, color: "#1d4ed8", fontWeight: 600 }}>{row.generated ? fmt(row.totalBilled) : dash}</td>
                  {/* Collected */}
                  <td style={{ ...S.td, color: "#16a34a", fontWeight: 600 }}>
                    {row.generated ? fmt(row.totalPaid) : dash}
                  </td>
                  {/* Advance Used */}
                  <td style={{ ...S.td, color: "#0891b2" }}>
                    {row.generated ? (
                      row.totalAdvance > 0 ? (
                        <span style={{ fontWeight: 600 }} title="Prev overpayment applied">{fmt(row.totalAdvance)}</span>
                      ) : <span style={{ color: "#e2e8f0" }}>—</span>
                    ) : dash}
                  </td>
                  {/* Pending */}
                  <td style={{ ...S.td }}>
                    {row.generated ? (
                      row.totalPending > 0 ? (
                        <div>
                          <div style={{ color: "#dc2626", fontWeight: 700 }}>{fmt(row.totalPending)}</div>
                          <div style={{ marginTop: 2 }}>
                            <ArrearsTrend prev={prevPending} curr={row.totalPending} />
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: "#16a34a", fontWeight: 700 }}>₹0</span>
                      )
                    ) : dash}
                  </td>
                  {/* Interest Generated */}
                  <td style={{ ...S.td, color: "#7c3aed" }}>
                    {row.generated ? (
                      row.totalInterest > 0
                        ? <span style={{ fontWeight: 600 }}>{fmt(row.totalInterest)}</span>
                        : <span style={{ color: "#e2e8f0" }}>—</span>
                    ) : dash}
                  </td>
                  {/* Sinking Fund */}
                  <td style={{ ...S.td, color: "#0891b2" }}>{row.generated ? fmt(row.totalSinking) : dash}</td>
                  {/* Repair Fund */}
                  <td style={{ ...S.td, color: "#ea580c" }}>{row.generated ? fmt(row.totalRepair) : dash}</td>
                  {/* Collection % */}
                  <td style={S.td}>
                    {row.generated && row.totalBilled > 0 ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 56, height: 7, background: "#e2e8f0", borderRadius: 4, overflow: "hidden", flexShrink: 0 }}>
                          <div style={{ width: effectivePct + "%", height: "100%", background: collectionColor(effectivePct), borderRadius: 4, transition: "width 0.3s" }} />
                        </div>
                        <span style={{ fontSize: "0.75rem", fontWeight: 700, color: collectionColor(effectivePct), background: collectionBg(effectivePct), padding: "1px 6px", borderRadius: 4, whiteSpace: "nowrap" }}>
                          {effectivePct}%
                        </span>
                      </div>
                    ) : dash}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <FYClosingRow timeline={timeline} summary={summary} />
          </tfoot>
        </table>
      </div>
      {/* Annual Totals Footer */}
      <div style={{ background: "#f8fafc", borderTop: "2px solid #e2e8f0", padding: "1rem 1.25rem" }}>
        <div style={{ fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "#94a3b8", marginBottom: "0.75rem" }}>Annual Totals</div>
        <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
          {(() => {
            const genMonths = timeline.filter(r => r.generated);
            const lastGen = genMonths[genMonths.length - 1];
            const fyOutstanding = lastGen?.totalPending ?? 0;
            return [
              { label: "Total Bills Raised", val: timeline.reduce((s, r) => s + (r.totalBilled || 0), 0), color: "#1d4ed8" },
              { label: "Total Cash Collected", val: timeline.reduce((s, r) => s + (r.totalPaid || 0), 0), color: "#16a34a" },
              { label: "Total Advance Used", val: timeline.reduce((s, r) => s + (r.totalAdvance || 0), 0), color: "#0891b2" },
              { label: "Total Interest Generated", val: timeline.reduce((s, r) => s + (r.totalInterest || 0), 0), color: "#7c3aed" },
              { label: "Total Sinking Fund", val: timeline.reduce((s, r) => s + (r.totalSinking || 0), 0), color: "#0891b2" },
              { label: "Total Repair Fund", val: timeline.reduce((s, r) => s + (r.totalRepair || 0), 0), color: "#ea580c" },
              { label: "FY Closing Outstanding", val: fyOutstanding, color: fyOutstanding > 0 ? "#dc2626" : "#16a34a" },
            ];
          })().map((r) => (
            <div key={r.label} style={{ minWidth: 140 }}>
              <div style={{ fontSize: "0.65rem", color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", marginBottom: 2 }}>{r.label}</div>
              <div style={{ fontSize: "1rem", fontWeight: 800, color: r.color }}>{fmt(r.val)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
function ClosingPanel({ closing, summary, fy, fyClosingOutstanding = 0 }) {
  if (!closing) return null;
  const { scenario, firstGenerated, lastGenerated, lastFullyPaid, nextToGenerate, marchStatus } = closing;
  const scenarioConfig = {
    NO_BILLS: { color: "#64748b", bg: "#f8fafc", border: "#e2e8f0", icon: "📭", label: "No Bills Generated" },
    MID_YEAR: { color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe", icon: "📅", label: "Mid-Year — FY In Progress" },
    MARCH_GENERATED_UNPAID: { color: "#d97706", bg: "#fffbeb", border: "#fde68a", icon: "⚠️", label: "March Generated — Payment Pending" },
    MARCH_PAID: { color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0", icon: "✅", label: "Financial Year Closed" },
  };
  const sc = scenarioConfig[scenario] || scenarioConfig.NO_BILLS;
  return (
    <div style={{ background: sc.bg, border: `1px solid ${sc.border}`, borderLeft: `4px solid ${sc.color}`, borderRadius: 10, padding: "1.5rem", marginBottom: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <div style={{ fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: sc.color, marginBottom: 6 }}>
            {sc.icon} FY Closing Status
          </div>
          <div style={{ fontSize: "1.15rem", fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>{sc.label}</div>
          {scenario === "NO_BILLS" && (
            <p style={{ color: "#64748b", fontSize: "0.85rem", margin: 0 }}>No bills generated for FY {fy}–{fy + 1} yet. Generate April {fy} bills to begin.</p>
          )}
          {scenario === "MID_YEAR" && (
            <div style={{ fontSize: "0.85rem", color: "#1e40af" }}>
              <div>FY started <strong>Apr {fy}</strong></div>
              {firstGenerated && <div style={{ marginTop: 4 }}>Billing started from: <strong>{firstGenerated.label}</strong></div>}
              {lastFullyPaid && <div style={{ marginTop: 4 }}>Payments confirmed up to: <strong style={{ color: "#16a34a" }}>{lastFullyPaid.label}</strong></div>}
              {lastGenerated && !lastGenerated.allPaid && (
                <div style={{ marginTop: 4 }}>Last generated: <strong>{lastGenerated.label}</strong> — <span style={{ color: "#dc2626" }}>{fmt(lastGenerated.totalPending)} pending</span></div>
              )}
              {nextToGenerate && <div style={{ marginTop: 4 }}>Next to generate: <strong>{nextToGenerate.label}</strong></div>}
              <div style={{ marginTop: 4 }}>Goal: Generate &amp; collect through <strong>Mar {fy + 1}</strong> to close FY</div>
            </div>
          )}
          {scenario === "MARCH_GENERATED_UNPAID" && marchStatus && (
            <div style={{ fontSize: "0.85rem", color: "#92400e" }}>
              <div>March {fy + 1} bill generated — financial year closing is <strong style={{ color: "#dc2626" }}>PENDING</strong></div>
              <div style={{ marginTop: 6, display: "flex", gap: "2rem", flexWrap: "wrap" }}>
                <div>Billed: <strong>{fmt(marchStatus.totalBilled)}</strong></div>
                <div>Collected: <strong style={{ color: "#16a34a" }}>{fmt(marchStatus.totalPaid)}</strong></div>
                <div>Outstanding: <strong style={{ color: "#dc2626" }}>{fmt(marchStatus.totalPending)}</strong></div>
                <div>Members paid: <strong>{marchStatus.paidCount}/{marchStatus.billCount}</strong></div>
              </div>
              <div style={{ marginTop: 6, padding: "0.5rem 0.75rem", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 6, color: "#92400e", fontSize: "0.8rem" }}>
                ⚠️ {marchStatus.unpaidCount} member(s) have not paid March dues. Collect payments and upload to close FY {fy}–{fy + 1}.
              </div>
            </div>
          )}
          {scenario === "MARCH_PAID" && marchStatus && (
            <div style={{ fontSize: "0.85rem", color: "#14532d" }}>
              <div>All March {fy + 1} bills cleared — FY <strong>{fy}–{fy + 1} fully closed</strong></div>
              <div style={{ marginTop: 6, padding: "0.5rem 0.75rem", background: "#dcfce7", border: "1px solid #bbf7d0", borderRadius: 6, color: "#14532d", fontSize: "0.8rem" }}>
                ✅ Financial year {fy}–{fy + 1} is closed. You may now set up billing for FY {fy + 1}–{fy + 2}.
              </div>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          {[
            { label: "FY Period", val: `Apr ${fy} – Mar ${fy + 1}` },
            { label: "Bills Generated", val: lastGenerated ? (firstGenerated?.label + " → " + lastGenerated?.label) : "None" },
            { label: "Last Confirmed Payment", val: lastFullyPaid?.label || "None yet" },
            { label: "FY Closing Outstanding", val: fmt(fyClosingOutstanding) },
          ].map((s) => (
            <div key={s.label} style={{ background: "white", borderRadius: 8, padding: "0.6rem 0.9rem", border: "1px solid #e2e8f0", minWidth: 140 }}>
              <div style={{ color: "#94a3b8", fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{s.label}</div>
              <div style={{ color: "#1e293b", fontWeight: 700, fontSize: "0.85rem", marginTop: 2 }}>{s.val}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
export default function BalanceSheetPage() {
  const qc = useQueryClient();
  const [fy, setFy] = useState(currentFY());
  const [newEntry, setNewEntry] = useState({ name: "", type: "Other Expense", income: "", expenditure: "" });
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["balance-sheet", fy],
    queryFn: () => fetchBalanceSheet(fy),
    staleTime: 2 * 60 * 1000,
  });
  const { data: entriesData, isLoading: entriesLoading } = useQuery({
    queryKey: ["society-entries", fy],
    queryFn: async () => {
      const res = await fetch(`/api/society-entries?fy=${fy}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 60_000,
  });
  const entries = entriesData?.entries || [];
  const summary = data?.summary || {};
  const closing = data?.closing || null;
  const timeline = data?.timeline || [];
  const availableFYs = data?.availableFYs || [];
  const fyYears = useMemo(() => {
    const set = new Set([...availableFYs, currentFY()]);
    return [...set].sort((a, b) => b - a).slice(0, 8);
  }, [availableFYs]);
  // FY closing outstanding = last generated month's pending (rolling state, not additive sum)
  const genMonths = timeline.filter(r => r.generated);
  const lastGenMonth = genMonths[genMonths.length - 1];
  const fyClosingOutstanding = lastGenMonth?.totalPending ?? 0;
  const customIncome = entries.reduce((s, e) => s + (e.entryKind === "income" ? (e.amount || 0) : 0), 0);
  const customExpenditure = entries.reduce((s, e) => s + (e.entryKind === "expenditure" ? (e.amount || 0) : 0), 0);
  const liabilityEntries = entries.filter((e) => e.entryKind === "income");
  const assetEntries = entries.filter((e) => e.entryKind === "expenditure");
  const handleAddEntry = async () => {
    if (!newEntry.name.trim()) return;
    if (!newEntry.income && !newEntry.expenditure) return;
    setSaving(true);
    try {
      const entryKind = newEntry.income ? "income" : "expenditure";
      const amount = parseFloat(newEntry.income || newEntry.expenditure);
      const res = await fetch("/api/society-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ fy, name: newEntry.name, type: newEntry.type, entryKind, amount }),
      });
      if (!res.ok) { const d = await res.json(); alert(d.error || "Failed to save"); return; }
      qc.invalidateQueries(["society-entries", fy]);
      setNewEntry({ name: "", type: "Other Expense", income: "", expenditure: "" });
      setAddOpen(false);
    } finally {
      setSaving(false);
    }
  };
  const removeEntry = async (id) => {
    if (!confirm("Delete this entry?")) return;
    await fetch(`/api/society-entries?id=${id}`, { method: "DELETE", credentials: "include" });
    qc.invalidateQueries(["society-entries", fy]);
  };
  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "#0f172a", letterSpacing: "-0.01em" }}>Balance Sheet</h1>
          <p style={{ color: "#64748b", fontSize: 13, marginTop: 2, margin: 0 }}>{data?.fyLabel || `Apr ${fy} – Mar ${fy + 1}`} · Full Financial Year Overview</p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <span style={{ color: "#64748b", fontSize: 12, fontWeight: 600 }}>Financial Year</span>
          <select value={fy} onChange={(e) => setFy(parseInt(e.target.value))} style={S.select}>
            {fyYears.map((y) => <option key={y} value={y}>FY {y}–{y + 1}</option>)}
          </select>
        </div>
      </div>
      {isLoading && <div style={{ padding: "4rem", textAlign: "center", color: "#94a3b8" }}>Loading...</div>}
      {error && <div style={{ padding: "2rem", color: "#ef4444", textAlign: "center" }}>{error.message}</div>}
      {!isLoading && !error && (
        <>
          <div style={S.sectionTitle}>FY Closing Status</div>
          <ClosingPanel closing={closing} summary={summary} fy={fy} fyClosingOutstanding={fyClosingOutstanding} />
          <div style={S.sectionTitle}>Financial Summary</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
            <div style={S.card("#3b82f6")}>
              <div style={S.cardLabel}>Total Billed</div>
              <div style={S.cardValue("#1d4ed8")}>{fmt(summary.totalBilled)}</div>
              <div style={S.cardSub}>{summary.billCount || 0} bills raised this FY</div>
            </div>
            <div style={S.card("#10b981")}>
              <div style={S.cardLabel}>Amount Collected</div>
              <div style={S.cardValue("#059669")}>{fmt(summary.totalCollected)}</div>
              <div style={S.cardSub}>{pctStr(summary.totalCollected, summary.totalBilled)} of total billed</div>
            </div>
            <div style={S.card(fyClosingOutstanding > 0 ? "#ef4444" : "#16a34a", fyClosingOutstanding > 0 ? "#fff" : "#f0fdf4")}>
              <div style={S.cardLabel}>FY Closing Outstanding</div>
              <div style={S.cardValue(fyClosingOutstanding > 0 ? "#dc2626" : "#16a34a")}>{fmt(fyClosingOutstanding)}</div>
              <div style={S.cardSub}>{fyClosingOutstanding > 0 ? "Dues still outstanding" : "All dues cleared ✓"}</div>
            </div>
            <div style={S.card("#f59e0b")}>
              <div style={S.cardLabel}>Prior Year Dues</div>
              <div style={S.cardValue("#d97706")}>{fmt(summary.priorPending)}</div>
              <div style={S.cardSub}>Carried from before Apr {fy}</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
            <div style={S.card("#8b5cf6")}>
              <div style={S.cardLabel}>Interest Generated</div>
              <div style={S.cardValue("#7c3aed")}>{fmt(summary.totalInterest)}</div>
              <div style={S.cardSub}>Late payment charges this FY</div>
              {summary.interestOutstanding > 0 && (
                <div style={{ marginTop: 6, fontSize: "0.68rem", color: "#dc2626", fontWeight: 700 }}>
                  ₹{Number(summary.interestOutstanding).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} still outstanding
                </div>
              )}
              {summary.interestOutstanding === 0 && summary.totalInterest > 0 && (
                <div style={{ marginTop: 6, fontSize: "0.68rem", color: "#16a34a", fontWeight: 700 }}>
                  ✓ All interest collected
                </div>
              )}
            </div>
            <div style={S.card("#06b6d4")}>
              <div style={S.cardLabel}>Sinking Fund</div>
              <div style={S.cardValue("#0891b2")}>{fmt(summary.totalSinking)}</div>
              <div style={S.cardSub}>Collected in bills</div>
            </div>
            <div style={S.card("#f97316")}>
              <div style={S.cardLabel}>Repair Fund</div>
              <div style={S.cardValue("#ea580c")}>{fmt(summary.totalRepair)}</div>
              <div style={S.cardSub}>Collected in bills</div>
            </div>
            <div style={S.card("#16a34a", "#f0fdf4")}>
              <div style={S.cardLabel}>Accrued Billing Revenue</div>
              <div style={S.cardValue("#15803d")}>{fmt((summary.totalCollected || 0) + (summary.totalInterest || 0))}</div>
              <div style={S.cardSub}>Cash collected + accrued interest</div>
            </div>
          </div>
          <MonthTimeline timeline={timeline} summary={summary} />
          <div style={S.sectionTitle}>Revenue & Outstanding Breakdown</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", marginBottom: "1.5rem" }}>
            <div style={S.panel("#bbf7d0", "#f0fdf4")}>
              <div style={{ marginBottom: "1rem" }}>
                <h3 style={{ ...S.panelHead("#16a34a"), marginBottom: 2 }}>Revenue & Collections Breakdown</h3>
                <div style={{ fontSize: "0.68rem", color: "#86efac" }}>Realized cash + charges — expense ledger not yet configured</div>
              </div>
              {[
                { name: "Total Bills Raised", val: summary.totalBilled },
                { name: "Cash Collected from Members", val: summary.totalCollected },
                { name: "Interest Generated (Late Charges)", val: summary.totalInterest },
                { name: "Sinking Fund Collected", val: summary.totalSinking },
                { name: "Repair Fund Collected", val: summary.totalRepair },
              ].map((r) => (
                <div key={r.name} style={S.divRow("#bbf7d0")}>
                  <span style={{ color: "#15803d" }}>{r.name}</span>
                  <span style={{ color: "#14532d", fontWeight: 700 }}>{fmt(r.val)}</span>
                </div>
              ))}
              {liabilityEntries.map((e) => (
                <div key={e._id} style={{ ...S.divRow("#bbf7d0") }}>
                  <span style={{ color: "#15803d" }}>{e.name} <span style={{ color: "#86efac", fontSize: "0.7rem" }}>[{e.type}]</span></span>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ color: "#14532d", fontWeight: 700 }}>{fmt(e.amount)}</span>
                    <button onClick={() => removeEntry(e._id)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer" }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
            <div style={S.panel("#fecaca", "#fff5f5")}>
              <div style={{ marginBottom: "1rem" }}>
                <h3 style={{ ...S.panelHead("#dc2626"), marginBottom: 2 }}>Outstanding & Receivables Breakdown</h3>
                <div style={{ fontSize: "0.68rem", color: "#fca5a5" }}>Uncollected dues — these are receivables, not expenses</div>
              </div>
              {[
                { name: "Prior Year Dues (Carried Forward)", val: summary.priorPending },
                { name: "FY Closing Outstanding (Current Dues)", val: fyClosingOutstanding },
              ].map((r) => (
                <div key={r.name} style={S.divRow("#fecaca")}>
                  <span style={{ color: "#b91c1c" }}>{r.name}</span>
                  <span style={{ color: "#7f1d1d", fontWeight: 700 }}>{fmt(r.val)}</span>
                </div>
              ))}
              {assetEntries.map((e) => (
                <div key={e._id} style={{ ...S.divRow("#fecaca") }}>
                  <span style={{ color: "#b91c1c" }}>{e.name} <span style={{ color: "#fca5a5", fontSize: "0.7rem" }}>[{e.type}]</span></span>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ color: "#7f1d1d", fontWeight: 700 }}>{fmt(e.amount)}</span>
                    <button onClick={() => removeEntry(e._id)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer" }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderLeft: "4px solid #16a34a",
            borderRadius: 10, padding: "1.25rem 1.5rem",
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: "2rem",
          }}>
            <div>
              <div style={{ color: "#64748b", fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Accrued Billing Revenue</div>
              <div style={{ color: "#94a3b8", fontSize: "0.72rem", marginTop: 2 }}>
                Cash collected + accrued interest generated this FY (includes unrealized interest not yet paid)
              </div>
              <div style={{ color: "#94a3b8", fontSize: "0.68rem", marginTop: 4, fontStyle: "italic" }}>
                Expense ledger not configured — vendor payments, utilities, maintenance spend not deducted
              </div>
            </div>
            <div style={{ color: "#15803d", fontSize: "2rem", fontWeight: 800 }}>
              {fmt((summary.totalCollected || 0) + (summary.totalInterest || 0))}
            </div>
          </div>
          {entries.length > 0 && (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, marginBottom: "1.5rem", overflow: "hidden" }}>
              <div style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
                <div style={S.sectionTitle}>Custom Entries ({entries.length})</div>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>{["Name", "Type", "Income", "Expenditure", "Side", ""].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => {
                    const isIncome = e.entryKind === "income";
                    return (
                      <tr key={e._id} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc" }}>
                        <td style={{ ...S.td, fontWeight: 600, color: "#1e293b" }}>{e.name}</td>
                        <td style={{ ...S.td, color: "#64748b" }}>{e.type}</td>
                        <td style={{ ...S.td, color: "#16a34a", fontWeight: 600 }}>{isIncome ? fmt(e.amount) : "—"}</td>
                        <td style={{ ...S.td, color: "#dc2626", fontWeight: 600 }}>{!isIncome ? fmt(e.amount) : "—"}</td>
                        <td style={S.td}>
                          <span style={S.badge(isIncome ? "#16a34a" : "#dc2626", isIncome ? "#dcfce7" : "#fee2e2")}>
                            {isIncome ? "Income" : "Expenditure"}
                          </span>
                        </td>
                        <td style={S.td}>
                          <button onClick={() => removeEntry(e._id)} style={{ background: "none", border: "1px solid #e2e8f0", color: "#94a3b8", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: "0.75rem" }}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <button
            onClick={() => setAddOpen(!addOpen)}
            style={{ padding: "0.5rem 1.25rem", borderRadius: 6, border: `1px solid ${addOpen ? "#ef4444" : "#3b82f6"}`, background: "transparent", color: addOpen ? "#ef4444" : "#3b82f6", fontWeight: 700, cursor: "pointer", fontSize: "0.85rem", marginBottom: "1rem" }}
          >
            {addOpen ? "✕ Cancel" : "+ Add Custom Entry"}
          </button>
          {addOpen && (
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.5rem" }}>
              <div style={{ ...S.sectionTitle, marginBottom: "1rem" }}>New Custom Entry</div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: "1rem", alignItems: "flex-end" }}>
                <div>
                  <label style={{ ...S.cardLabel, display: "block", marginBottom: 4 }}>Name *</label>
                  <input value={newEntry.name} onChange={(e) => setNewEntry({ ...newEntry, name: e.target.value })} placeholder="e.g. Water Tank Repair" style={S.input} />
                </div>
                <div>
                  <label style={{ ...S.cardLabel, display: "block", marginBottom: 4 }}>Type</label>
                  <select value={newEntry.type} onChange={(e) => setNewEntry({ ...newEntry, type: e.target.value })} style={{ ...S.input, cursor: "pointer" }}>
                    {ENTRY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ ...S.cardLabel, display: "block", marginBottom: 4 }}>Income (₹)</label>
                  <input type="number" value={newEntry.income} onChange={(e) => setNewEntry({ ...newEntry, income: e.target.value, expenditure: "" })} placeholder="0" min="0" style={S.input} />
                </div>
                <div>
                  <label style={{ ...S.cardLabel, display: "block", marginBottom: 4 }}>Expenditure (₹)</label>
                  <input type="number" value={newEntry.expenditure} onChange={(e) => setNewEntry({ ...newEntry, expenditure: e.target.value, income: "" })} placeholder="0" min="0" style={S.input} />
                </div>
              </div>
              <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem", alignItems: "center" }}>
                <button
                  onClick={handleAddEntry}
                  disabled={saving || !newEntry.name.trim() || (!newEntry.income && !newEntry.expenditure)}
                  style={{
                    padding: "0.55rem 1.5rem", borderRadius: 6, border: "none",
                    background: (!saving && newEntry.name.trim() && (newEntry.income || newEntry.expenditure)) ? "#16a34a" : "#cbd5e1",
                    color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.88rem",
                  }}
                >
                  {saving ? "Saving..." : "Save Entry"}
                </button>
                <span style={{ color: "#94a3b8", fontSize: "0.75rem" }}>Income OR Expenditure — not both. Name required.</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

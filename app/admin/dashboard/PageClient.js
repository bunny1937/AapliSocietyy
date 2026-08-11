"use client";
import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import styles from "@/styles/Dashboard.module.css";
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmt(n) {
  return (n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function Ring({ pct, color = "#3B82F6", size = 80, stroke = 8 }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (Math.min(pct, 100) / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E5E7EB" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.6s ease" }}
      />
    </svg>
  );
}
function BarChart({ data, height = 120 }) {
  if (!data || data.length === 0) return <div style={{ color: "#9CA3AF", padding: "1rem", textAlign: "center" }}>No data</div>;
  const maxVal = Math.max(...data.map((d) => Math.max(d.totalBilled || 0, d.totalCollected || 0)), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height, padding: "0 4px" }}>
      {data.map((d, i) => {
        const billedH = Math.round(((d.totalBilled || 0) / maxVal) * (height - 24));
        const collH = Math.round(((d.totalCollected || 0) / maxVal) * (height - 24));
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: height - 24 }}>
              <div
                title={`Billed: ₹${fmt(d.totalBilled)}`}
                style={{ width: 10, height: billedH || 2, background: "#BFDBFE", borderRadius: "2px 2px 0 0", transition: "height 0.4s" }}
              />
              <div
                title={`Collected: ₹${fmt(d.totalCollected)}`}
                style={{ width: 10, height: collH || 2, background: "#3B82F6", borderRadius: "2px 2px 0 0", transition: "height 0.4s" }}
              />
            </div>
            <span style={{ fontSize: 9, color: "#9CA3AF", whiteSpace: "nowrap" }}>{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}
export default function AdminDashboardPage() {
  const router = useRouter();
  const now = new Date();
  const [filterMonth, setFilterMonth] = useState(now.getMonth() + 1);
  const [filterYear, setFilterYear] = useState(now.getFullYear());
  const [yearOptions, setYearOptions] = useState([now.getFullYear()]);
  const [minYear, setMinYear] = useState(now.getFullYear());
  const [minMonth, setMinMonth] = useState(1);
  // FY starts Apr — compute current FY year
  const currentFyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const [fyYear, setFyYear] = useState(currentFyYear);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12
  useEffect(() => {
    fetch("/api/billing/year-range", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const min = d.minYear || currentYear;
        const years = [];
        for (let y = min; y <= currentYear; y++) years.push(y);
        if (years.length > 0) setYearOptions(years);
        setMinYear(min);
        setMinMonth(d.minMonth || 1);
      })
      .catch(() => {});
  }, []);
  // When year changes, clamp month to current month if we're on the current year
  const handleYearChange = (newYear) => {
    setFilterYear(newYear);
    if (newYear === currentYear && filterMonth > currentMonth) {
      setFilterMonth(currentMonth);
    } else if (newYear === minYear && filterMonth < minMonth) {
      setFilterMonth(minMonth);
    }
  };
  // Months available: clamp start at minMonth for minYear, clamp end at currentMonth for currentYear
  const availableMonths = MONTHS.map((m, i) => ({
    label: m,
    value: i + 1,
  })).filter((m) => {
    if (filterYear === minYear && m.value < minMonth) return false;
    if (filterYear === currentYear && m.value > currentMonth) return false;
    return true;
  });
  const { data: stats, isLoading } = useQuery({
    queryKey: ["dashboard-stats", filterMonth, filterYear, fyYear],
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/dashboard-stats?month=${filterMonth}&year=${filterYear}&fyYear=${fyYear}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 60_000,
  });
  const outstanding = stats?.outstanding || {};
  const period = stats?.period || {};
  const fy = stats?.fy || {};
  const trend = stats?.trend || [];
  const recentPayments = stats?.recentPayments || [];
  const paymentModes = stats?.paymentModes || [];
  const totalMembers = stats?.totalMembers || 0;
  const collectionRate = period.collectionRate || 0;
  const fyCollectionRate = fy.collectionRate || 0;
  const fyYearOptions = useMemo(() => {
    const opts = [];
    const minFy = yearOptions[0] || currentYear - 2;
    // Cap FY at currentFyYear — never show future FY
    for (let y = minFy; y <= currentFyYear; y++) opts.push(y);
    return opts;
  }, [yearOptions, currentFyYear]);
  const periodLabel = filterMonth && filterYear
    ? `${MONTHS[filterMonth - 1]} ${filterYear}`
    : filterYear || "All";
  const cardStyle = {
    background: "#fff",
    borderRadius: 12,
    border: "1px solid #E5E7EB",
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
  };
  const quickLinks = [
    { label: "Generate Bills", icon: "📄", path: "/admin/generate-bills", color: "#3B82F6" },
    { label: "Record Payment", icon: "💳", path: "/admin/payments", color: "#059669" },
    { label: "View Bills", icon: "🧾", path: "/admin/view-bills", color: "#7C3AED" },
    { label: "Import Members", icon: "📥", path: "/admin/import-members", color: "#D97706" },
    { label: "Ledger", icon: "📖", path: "/admin/ledger", color: "#0891B2" },
    { label: "Billing Config", icon: "⚙️", path: "/admin/billing-config", color: "#6B7280" },
    { label: "Bill Template", icon: "📝", path: "/admin/bill-template", color: "#EC4899" },
    { label: "Society Config", icon: "🏢", path: "/admin/society-config", color: "#14B8A6" },
  ];
  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* ── Header ── */}
      <div className={styles.pageHeader} style={{ marginBottom: "1.5rem" }}>
        <div>
          <h1 className={styles.pageTitle} style={{ margin: 0 }}>Dashboard</h1>
          <p className={styles.pageSubtitle} style={{ margin: "0.25rem 0 0" }}>
            Society financial overview
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.75rem", color: "#6B7280", fontWeight: 600 }}>Period:</span>
          <select
            value={filterMonth}
            onChange={(e) => setFilterMonth(Number(e.target.value))}
            style={{ padding: "0.35rem 0.6rem", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.85rem" }}
          >
            {availableMonths.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <select
            value={filterYear}
            onChange={(e) => handleYearChange(Number(e.target.value))}
            style={{ padding: "0.35rem 0.6rem", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.85rem" }}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <span style={{ fontSize: "0.75rem", color: "#6B7280", fontWeight: 600, marginLeft: 8 }}>FY:</span>
          <select
            value={fyYear}
            onChange={(e) => setFyYear(Number(e.target.value))}
            style={{ padding: "0.35rem 0.6rem", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.85rem" }}
          >
            {fyYearOptions.map((y) => (
              <option key={y} value={y}>FY {y}-{String(y + 1).slice(-2)}</option>
            ))}
          </select>
        </div>
      </div>
      {isLoading && (
        <div style={{ textAlign: "center", padding: "2rem", color: "#6B7280" }}>Loading...</div>
      )}
      {/* ── Top KPI Row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem", marginBottom: "1.5rem" }}>
        {/* Total Members */}
        <div
          style={{ ...cardStyle, padding: "1.25rem", borderLeft: "4px solid #3B82F6", cursor: "pointer" }}
          onClick={() => router.push("/admin/view-members")}
        >
          <div style={{ fontSize: "0.75rem", color: "#6B7280", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Total Members
          </div>
          <div style={{ fontSize: "2rem", fontWeight: 800, color: "#1F2937", marginTop: 6 }}>
            {totalMembers}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#9CA3AF", marginTop: 4 }}>Active flats</div>
        </div>
        {/* All-time Outstanding */}
        <div
          style={{ ...cardStyle, padding: "1.25rem", borderLeft: "4px solid #DC2626", cursor: "pointer" }}
          onClick={() => router.push("/admin/view-bills")}
        >
          <div style={{ fontSize: "0.75rem", color: "#6B7280", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Total Outstanding
          </div>
          <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "#DC2626", marginTop: 6 }}>
            ₹{fmt(outstanding.total)}
          </div>
          <div style={{ fontSize: "0.72rem", color: "#9CA3AF", marginTop: 4 }}>
            {outstanding.unpaidBillCount || 0} unpaid bills &bull; ₹{fmt(outstanding.interest)} interest
          </div>
        </div>
        {/* Period Collected */}
        <div
          style={{ ...cardStyle, padding: "1.25rem", borderLeft: "4px solid #059669", cursor: "pointer" }}
          onClick={() => router.push("/admin/payments")}
        >
          <div style={{ fontSize: "0.75rem", color: "#6B7280", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Collected — {periodLabel}
          </div>
          <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "#059669", marginTop: 6 }}>
            ₹{fmt(period.totalCollected)}
          </div>
          <div style={{ fontSize: "0.72rem", color: "#9CA3AF", marginTop: 4 }}>
            of ₹{fmt(period.totalBilled)} billed &bull; {collectionRate}% collected
          </div>
        </div>
        {/* FY Progress */}
        <div
          style={{ ...cardStyle, padding: "1.25rem", borderLeft: "4px solid #7C3AED" }}
        >
          <div style={{ fontSize: "0.75rem", color: "#6B7280", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {fy.label || `FY ${fyYear}`}
          </div>
          <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "#7C3AED", marginTop: 6 }}>
            ₹{fmt(fy.totalCollected)}
          </div>
          <div style={{ fontSize: "0.72rem", color: "#9CA3AF", marginTop: 4 }}>
            of ₹{fmt(fy.totalBilled)} billed &bull; {fyCollectionRate}% rate
          </div>
        </div>
      </div>
      {/* ── Second Row: Period Detail + Collection Ring + Bar Chart ── */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1.5fr", gap: "1rem", marginBottom: "1.5rem" }}>
        {/* Period Detail Card */}
        <div style={{ ...cardStyle, padding: "1.25rem" }}>
          <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#1F2937", marginBottom: "1rem" }}>
            {periodLabel} — Bill Summary
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            {[
              { label: "Total Billed", value: `₹${fmt(period.totalBilled)}`, color: "#1F2937" },
              { label: "Collected", value: `₹${fmt(period.totalCollected)}`, color: "#059669" },
              { label: "Outstanding", value: `₹${fmt(period.totalBalance)}`, color: "#DC2626" },
              { label: "Interest Charged", value: `₹${fmt(period.interestCharged)}`, color: "#D97706" },
              { label: "Bills Generated", value: period.totalCount || 0, color: "#1F2937" },
              { label: "Paid / Unpaid", value: `${period.paidCount || 0} / ${period.unpaidCount || 0}`, color: "#6B7280" },
            ].map((row) => (
              <div key={row.label} style={{ background: "#F9FAFB", borderRadius: 8, padding: "0.6rem 0.8rem" }}>
                <div style={{ fontSize: "0.7rem", color: "#9CA3AF", fontWeight: 600, textTransform: "uppercase" }}>{row.label}</div>
                <div style={{ fontSize: "1rem", fontWeight: 800, color: row.color, marginTop: 2 }}>{row.value}</div>
              </div>
            ))}
          </div>
        </div>
        {/* Collection Rate Ring */}
        <div style={{ ...cardStyle, padding: "1.25rem", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.75rem" }}>
          <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#1F2937", textAlign: "center" }}>
            Collection Rate
          </div>
          <div style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <Ring pct={collectionRate} color={collectionRate >= 80 ? "#059669" : collectionRate >= 50 ? "#D97706" : "#DC2626"} size={100} stroke={10} />
            <div style={{ position: "absolute", textAlign: "center" }}>
              <div style={{ fontSize: "1.25rem", fontWeight: 800, color: "#1F2937" }}>{collectionRate}%</div>
              <div style={{ fontSize: "0.6rem", color: "#9CA3AF" }}>{periodLabel}</div>
            </div>
          </div>
          <div style={{ fontSize: "0.72rem", color: "#6B7280", textAlign: "center" }}>
            FY Rate: <strong style={{ color: "#7C3AED" }}>{fyCollectionRate}%</strong>
          </div>
          {/* Payment modes */}
          <div style={{ width: "100%", marginTop: "0.5rem" }}>
            {paymentModes.slice(0, 4).map((m) => (
              <div key={m.mode} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", padding: "3px 0", borderBottom: "1px solid #F3F4F6" }}>
                <span style={{ color: "#6B7280" }}>{m.mode}</span>
                <span style={{ fontWeight: 700 }}>₹{fmt(m.total)}</span>
              </div>
            ))}
          </div>
        </div>
        {/* 6-Month Bar Chart */}
        <div style={{ ...cardStyle, padding: "1.25rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
            <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#1F2937" }}>6-Month Trend</div>
            <div style={{ display: "flex", gap: 8, fontSize: "0.65rem", color: "#9CA3AF" }}>
              <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#BFDBFE", borderRadius: 2, marginRight: 3 }} />Billed</span>
              <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#3B82F6", borderRadius: 2, marginRight: 3 }} />Collected</span>
            </div>
          </div>
          <BarChart data={trend} height={130} />
          {trend.length > 0 && (
            <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: 2 }}>
              {trend.slice(-3).map((t) => (
                <div key={t.label} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem" }}>
                  <span style={{ color: "#6B7280" }}>{t.label}</span>
                  <span style={{ fontWeight: 700, color: "#059669" }}>₹{fmt(t.totalCollected)}</span>
                  <span style={{ color: "#DC2626", fontSize: "0.65rem" }}>bal ₹{fmt(t.totalBalance)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {/* ── Quick Actions ── */}
      <div style={{ ...cardStyle, padding: "1rem", marginBottom: "1.5rem" }}>
        <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#1F2937", marginBottom: "0.75rem" }}>Quick Actions</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "0.75rem" }}>
          {quickLinks.map((link) => (
            <button
              key={link.label}
              onClick={() => router.push(link.path)}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: "0.4rem",
                padding: "0.9rem 0.75rem", background: "#F9FAFB",
                border: `1px solid #E5E7EB`, borderRadius: 10,
                cursor: "pointer", fontSize: "0.8rem", fontWeight: 600, color: "#1F2937",
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#EFF6FF";
                e.currentTarget.style.borderColor = link.color;
                e.currentTarget.style.color = link.color;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#F9FAFB";
                e.currentTarget.style.borderColor = "#E5E7EB";
                e.currentTarget.style.color = "#1F2937";
              }}
            >
              <span style={{ fontSize: "1.5rem" }}>{link.icon}</span>
              {link.label}
            </button>
          ))}
        </div>
      </div>
      {/* ── FY Summary Row ── */}
      <div style={{ ...cardStyle, padding: "1.25rem", marginBottom: "1.5rem" }}>
        <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#1F2937", marginBottom: "1rem" }}>
          {fy.label || `FY ${fyYear}`} — Full Year Summary
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "1rem" }}>
          {[
            { label: "Total Billed", value: `₹${fmt(fy.totalBilled)}`, color: "#1F2937" },
            { label: "Collected (Bills)", value: `₹${fmt(fy.totalCollected)}`, color: "#059669" },
            { label: "Outstanding", value: `₹${fmt(outstanding.total)}`, color: "#DC2626" },
            { label: "Prior Year Dues", value: `₹${fmt(outstanding.total - fy.totalBalance)}`, color: "#D97706" },
            { label: "FY Collection Rate", value: `${fyCollectionRate}%`, color: "#7C3AED" },
          ].map((item) => (
            <div key={item.label} style={{ textAlign: "center", background: "#F9FAFB", borderRadius: 8, padding: "0.75rem" }}>
              <div style={{ fontSize: "0.7rem", color: "#9CA3AF", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 800, color: item.color }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>
      {/* ── Bottom Row: Recent Payments + Trend Table ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
        {/* Recent Payments */}
        <div style={{ ...cardStyle, overflow: "hidden" }}>
          <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #E5E7EB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>Recent Payments</span>
            <button
              onClick={() => router.push("/admin/payments")}
              style={{ fontSize: "0.75rem", color: "#3B82F6", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}
            >
              View All →
            </button>
          </div>
          <div style={{ overflowX: "auto" }}>
            {recentPayments.length === 0 ? (
              <div style={{ padding: "2rem", textAlign: "center", color: "#9CA3AF" }}>No payments recorded</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#F9FAFB", borderBottom: "1px solid #E5E7EB" }}>
                    {["Member", "Period", "Amount", "Mode", "Date", "By"].map((h) => (
                      <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: "11px", color: "#6B7280", fontWeight: 700, textTransform: "uppercase" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentPayments.map((p, i) => (
                    <tr key={p._id || i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={{ padding: "8px 12px", fontSize: "12px", fontWeight: 600 }}>
                        {p.memberId ? `${p.memberId.wing}-${p.memberId.flatNo}` : "—"}
                        {p.memberId?.ownerName && (
                          <div style={{ fontSize: "10px", color: "#9CA3AF", fontWeight: 400 }}>{p.memberId.ownerName}</div>
                        )}
                      </td>
                      <td style={{ padding: "8px 12px", fontSize: "11px", color: "#6B7280" }}>
                        {p.billPeriodId || "—"}
                      </td>
                      <td style={{ padding: "8px 12px", fontSize: "13px", fontWeight: 700, color: "#059669" }}>
                        ₹{(p.amount || 0).toLocaleString("en-IN")}
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        <span style={{ background: "#DBEAFE", color: "#1E40AF", padding: "2px 7px", borderRadius: 10, fontSize: "10px", fontWeight: 700 }}>
                          {p.paymentMode || "Cash"}
                        </span>
                      </td>
                      <td style={{ padding: "8px 12px", fontSize: "11px", color: "#6B7280", whiteSpace: "nowrap" }}>
                        {p.date ? new Date(p.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}
                      </td>
                      <td style={{ padding: "8px 12px", fontSize: "11px", color: "#9CA3AF" }}>
                        {p.createdBy || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        {/* 6-Month Trend Table */}
        <div style={{ ...cardStyle, overflow: "hidden" }}>
          <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #E5E7EB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>Monthly Breakdown</span>
            <button
              onClick={() => router.push("/admin/ledger")}
              style={{ fontSize: "0.75rem", color: "#3B82F6", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}
            >
              Full Ledger →
            </button>
          </div>
          <div style={{ overflowX: "auto" }}>
            {trend.length === 0 ? (
              <div style={{ padding: "2rem", textAlign: "center", color: "#9CA3AF" }}>No billing data</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#F9FAFB", borderBottom: "1px solid #E5E7EB" }}>
                    {["Period", "Billed", "Collected", "Balance", "Rate"].map((h) => (
                      <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: "11px", color: "#6B7280", fontWeight: 700, textTransform: "uppercase" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...trend].reverse().map((t, i) => {
                    const rate = t.totalBilled > 0 ? Math.round((t.totalCollected / t.totalBilled) * 100) : 0;
                    return (
                      <tr
                        key={i}
                        style={{ borderBottom: "1px solid #F3F4F6", cursor: "pointer" }}
                        onClick={() => {
                          setFilterMonth(t.billMonth + 1);
                          setFilterYear(t.billYear);
                        }}
                      >
                        <td style={{ padding: "8px 10px", fontSize: "12px", fontWeight: 600 }}>{t.label}</td>
                        <td style={{ padding: "8px 10px", fontSize: "11px" }}>₹{fmt(t.totalBilled)}</td>
                        <td style={{ padding: "8px 10px", fontSize: "11px", color: "#059669", fontWeight: 600 }}>₹{fmt(t.totalCollected)}</td>
                        <td style={{ padding: "8px 10px", fontSize: "11px", color: "#DC2626" }}>₹{fmt(t.totalBalance)}</td>
                        <td style={{ padding: "8px 10px" }}>
                          <span style={{
                            fontSize: "10px", fontWeight: 700, padding: "2px 6px", borderRadius: 8,
                            background: rate >= 80 ? "#D1FAE5" : rate >= 50 ? "#FEF3C7" : "#FEE2E2",
                            color: rate >= 80 ? "#065F46" : rate >= 50 ? "#92400E" : "#991B1B",
                          }}>
                            {rate}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Card,
  PageHeader,
  Button,
  StatCard,
  StatusBadge,
  PurposeTag,
  Spinner,
  EmptyState,
  grid,
  tokens,
  fmtTime,
} from "@/components/visitor/ui";
async function api(url) {
  const res = await fetch(url, { credentials: "include" });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || "Request failed");
  return data;
}
const S = {
  section: { marginTop: 22 },
  sectionHead: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: 700, color: tokens.text },
  barRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 },
  barLabel: { width: 120, fontSize: 13, color: tokens.sub },
  barTrack: { flex: 1, height: 10, background: "#f1f5f9", borderRadius: 999, overflow: "hidden" },
  barFill: { height: "100%", background: tokens.primary, borderRadius: 999 },
  barWrap: { marginTop: 12 },
  barVal: { width: 40, textAlign: "right", fontSize: 13, fontWeight: 600, color: tokens.text },
  hourGrid: { display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 3, alignItems: "end", height: 120, marginTop: 8 },
  hourBar: { background: tokens.primary, borderRadius: 3, minHeight: 2 },
  hourLabels: { display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 3, marginTop: 4 },
  hourLabel: { fontSize: 8, color: tokens.sub, textAlign: "center" },
  center: { display: "flex", justifyContent: "center", padding: 48 },
  rangeRow: { display: "flex", gap: 8 },
  row: { display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #f3f4f6" },
  rowMain: { flex: 1, minWidth: 0 },
  rowName: { fontWeight: 600, color: tokens.text },
  rowMeta: { fontSize: 12, color: tokens.sub, marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" },
};
function rangeBtn(active) {
  return {
    padding: "6px 12px",
    borderRadius: 8,
    border: active ? "1px solid " + tokens.primary : "1px solid #e5e7eb",
    background: active ? "#eef2ff" : "#fff",
    color: active ? tokens.primary : tokens.sub,
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  };
}
export default function AdminVisitorsOverview() {
  const [summary, setSummary] = useState({});
  const [recent, setRecent] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, an] = await Promise.all([
        api("/api/admin/visitors?limit=8"),
        api("/api/admin/visitors/analytics?days=" + days),
      ]);
      setSummary((list && list.summary) || {});
      setRecent((list && list.visitors) || []);
      setAnalytics(an);
    } catch (_) {
    } finally {
      setLoading(false);
    }
  }, [days]);
  useEffect(() => {
    load();
  }, [load]);
  const total = Object.values(summary).reduce((a, b) => a + b, 0);
  const maxPurpose = analytics ? Math.max(1, ...analytics.byPurpose.map((p) => p.count)) : 1;
  const maxHour = analytics ? Math.max(1, ...analytics.byHour.map((h) => h.count)) : 1;
  const hourMap = {};
  if (analytics) analytics.byHour.forEach((h) => (hourMap[h._id] = h.count));
  return (
    <div>
      <PageHeader
        title="Visitor Management"
        subtitle="Society-wide overview, trends and quick access"
        actions={
          <Link href="/admin/visitors/log">
            <Button variant="ghost">Open full log</Button>
          </Link>
        }
      />
      <div style={grid(170)}>
        <StatCard label="Total visitors" value={total} icon="👥" />
        <StatCard label="Inside now" value={summary.Entered || 0} color={tokens.success} icon="🟢" />
        <StatCard label="Awaiting approval" value={summary.Pending || 0} color="#f59e0b" icon="⏳" />
        <StatCard label="Approved" value={summary.Approved || 0} color="#3b82f6" icon="✅" />
        <StatCard label="Rejected" value={summary.Rejected || 0} color={tokens.danger} icon="⛔" />
        <StatCard
          label="Avg approval"
          value={analytics && analytics.avgApprovalMinutes != null ? analytics.avgApprovalMinutes + "m" : "—"}
          color="#8b5cf6"
          icon="⚡"
        />
      </div>
      {loading ? (
        <div style={S.center}>
          <Spinner size={28} />
        </div>
      ) : (
        <>
          <div style={S.section}>
            <div style={S.sectionHead}>
              <div style={S.sectionTitle}>Trends</div>
              <div style={S.rangeRow}>
                {[7, 30, 90].map((d) => (
                  <button key={d} style={rangeBtn(days === d)} onClick={() => setDays(d)}>
                    {d}d
                  </button>
                ))}
              </div>
            </div>
            <div style={grid(320)}>
              <Card>
                <div style={S.sectionTitle}>By purpose</div>
                <div style={S.barWrap}>
                  {analytics && analytics.byPurpose.length ? (
                    analytics.byPurpose.map((p) => {
                      const fill = Object.assign({}, S.barFill, {
                        width: Math.round((p.count / maxPurpose) * 100) + "%",
                      });
                      return (
                        <div key={p._id || "none"} style={S.barRow}>
                          <span style={S.barLabel}>
                            <PurposeTag purpose={p._id || "Other"} />
                          </span>
                          <span style={S.barTrack}>
                            <span style={fill} />
                          </span>
                          <span style={S.barVal}>{p.count}</span>
                        </div>
                      );
                    })
                  ) : (
                    <EmptyState icon="📊" title="No data yet" />
                  )}
                </div>
              </Card>
              <Card>
                <div style={S.sectionTitle}>Peak hours</div>
                <div style={S.hourGrid}>
                  {Array.from({ length: 24 }).map((_, h) => {
                    const hb = Object.assign({}, S.hourBar, {
                      height: Math.max(2, Math.round(((hourMap[h] || 0) / maxHour) * 110)),
                    });
                    return (
                      <div
                        key={h}
                        title={h + ":00 — " + (hourMap[h] || 0) + " visitors"}
                        style={hb}
                      />
                    );
                  })}
                </div>
                <div style={S.hourLabels}>
                  {Array.from({ length: 24 }).map((_, h) => (
                    <div key={h} style={S.hourLabel}>
                      {h % 6 === 0 ? h : ""}
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
          <div style={S.section}>
            <div style={S.sectionHead}>
              <div style={S.sectionTitle}>Recent activity</div>
              <Link href="/admin/visitors/log">
                <Button variant="subtle" size="sm">
                  View all
                </Button>
              </Link>
            </div>
            <Card>
              {recent.length === 0 ? (
                <EmptyState icon="🚪" title="No visitors yet" />
              ) : (
                recent.map((v) => (
                  <div key={v._id} style={S.row}>
                    <div style={S.rowMain}>
                      <div style={S.rowName}>{v.name}</div>
                      <div style={S.rowMeta}>
                        <PurposeTag purpose={v.purpose} /> · Flat{" "}
                        {v.memberId && v.memberId.wing ? v.memberId.wing + "-" : ""}
                        {(v.memberId && v.memberId.flatNo) || "—"} · {fmtTime(v.createdAt)}
                      </div>
                    </div>
                    <StatusBadge status={v.status} />
                  </div>
                ))
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

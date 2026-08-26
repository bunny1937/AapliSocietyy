"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Card,
  PageHeader,
  Button,
  Input,
  Select,
  StatusBadge,
  PurposeTag,
  Avatar,
  EmptyState,
  Spinner,
  Toast,
  tokens,
  fmtTime,
} from "@/components/visitor/ui";
import { VISITOR_STATUSES } from "@/lib/visitor-config";
async function api(url, opts) {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || "Request failed");
  return data;
}
const STATUSES = Array.isArray(VISITOR_STATUSES)
  ? VISITOR_STATUSES
  : ["Pending", "Approved", "Rejected", "Entered", "Exited", "Expired"];
const S = {
  filters: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16, alignItems: "flex-end" },
  filterItem: { minWidth: 160 },
  filterLabel: { display: "block", fontSize: 12, fontWeight: 600, color: tokens.sub, marginBottom: 6 },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: {
    textAlign: "left",
    padding: "10px 12px",
    color: tokens.sub,
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase",
    borderBottom: "1px solid var(--bg-muted)",
    whiteSpace: "nowrap",
  },
  td: { padding: "12px", borderBottom: "1px solid var(--bg-muted)", verticalAlign: "middle" },
  visitorCell: { display: "flex", alignItems: "center", gap: 10 },
  vname: { fontWeight: 600, color: tokens.text },
  vphone: { fontSize: 12, color: tokens.sub },
  center: { display: "flex", justifyContent: "center", padding: 50 },
  pager: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 },
  pageInfo: { fontSize: 13, color: tokens.sub },
};
export default function SecurityLogsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [scope, setScope] = useState("today");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState(null);
  const notify = (message, type = "info") => setToast({ message, type });
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("scope", scope);
      params.set("page", String(page));
      params.set("limit", "20");
      if (status) params.set("status", status);
      if (q.trim()) params.set("q", q.trim());
      const data = await api("/api/visitor/list?" + params.toString());
      const list = (data && (data.visitors || data.data)) || [];
      setRows(list);
      setHasMore(Boolean(data && (data.hasMore || (data.total && page * 20 < data.total))));
    } catch (e) {
      notify(e.message || "Failed to load logs", "error");
    } finally {
      setLoading(false);
    }
  }, [scope, status, q, page]);
  useEffect(() => {
    load();
  }, [load]);
  const doExit = async (id) => {
    setBusyId(id);
    try {
      await api("/api/visitor/exit", { method: "PATCH", body: JSON.stringify({ visitorId: id }) });
      notify("Visitor checked out", "success");
      await load();
    } catch (e) {
      notify(e.message || "Action failed", "error");
    } finally {
      setBusyId(null);
    }
  };
  return (
    <div>
      <PageHeader
        title="Visitor Log"
        subtitle="Searchable history of every gate entry"
        actions={
          <Button variant="ghost" onClick={load}>
            ↻ Refresh
          </Button>
        }
      />
      <Card>
        <div style={S.filters}>
          <div style={S.filterItem}>
            <label style={S.filterLabel}>Search</label>
            <Input
              placeholder="Name, phone, vehicle…"
              value={q}
              onChange={(e) => {
                setPage(1);
                setQ(e.target.value);
              }}
            />
          </div>
          <div style={S.filterItem}>
            <label style={S.filterLabel}>Period</label>
            <Select
              value={scope}
              onChange={(e) => {
                setPage(1);
                setScope(e.target.value);
              }}
            >
              <option value="today">Today</option>
              <option value="all">All time</option>
              <option value="active">Inside now</option>
              <option value="pending">Pending</option>
            </Select>
          </div>
          <div style={S.filterItem}>
            <label style={S.filterLabel}>Status</label>
            <Select
              value={status}
              onChange={(e) => {
                setPage(1);
                setStatus(e.target.value);
              }}
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {loading ? (
          <div style={S.center}>
            <Spinner size={28} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon="📒" title="No visitors found" subtitle="Try adjusting the filters." />
        ) : (
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Visitor</th>
                  <th style={S.th}>Purpose</th>
                  <th style={S.th}>Flat</th>
                  <th style={S.th}>Vehicle</th>
                  <th style={S.th}>Entry</th>
                  <th style={S.th}>Status</th>
                  <th style={S.th}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => {
                  const id = v._id || v.id;
                  return (
                    <tr key={id}>
                      <td style={S.td}>
                        <div style={S.visitorCell}>
                          <Avatar src={v.photo} name={v.name} size={36} />
                          <div>
                            <div style={S.vname}>{v.name}</div>
                            {v.phone && <div style={S.vphone}>{v.phone}</div>}
                          </div>
                        </div>
                      </td>
                      <td style={S.td}>
                        <PurposeTag purpose={v.purpose} />
                      </td>
                      <td style={S.td}>
                        {v.memberId && v.memberId.wing ? v.memberId.wing + "-" : ""}
                        {(v.memberId && v.memberId.flatNo) || "—"}
                      </td>
                      <td style={S.td}>{v.vehicleNumber || "—"}</td>
                      <td style={S.td}>{fmtTime(v.entryTime || v.createdAt)}</td>
                      <td style={S.td}>
                        <StatusBadge status={v.status} />
                      </td>
                      <td style={S.td}>
                        {["Entered", "Approved"].includes(v.status) && (
                          <Button size="sm" variant="subtle" disabled={busyId === id} onClick={() => doExit(id)}>
                            Check out
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={S.pager}>
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            ← Prev
          </Button>
          <span style={S.pageInfo}>Page {page}</span>
          <Button variant="ghost" size="sm" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>
            Next →
          </Button>
        </div>
      </Card>
      <Toast {...(toast || {})} onClose={() => setToast(null)} />
    </div>
  );
}

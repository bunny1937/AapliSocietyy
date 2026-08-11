"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Card,
  PageHeader,
  Button,
  Input,
  Select,
  Avatar,
  StatusBadge,
  PurposeTag,
  Spinner,
  EmptyState,
  tokens,
  fmtTime,
} from "@/components/visitor/ui";
import { VISITOR_STATUSES, VISITOR_PURPOSES } from "@/lib/visitor-config";
async function api(url) {
  const res = await fetch(url, { credentials: "include" });
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
const PURPOSES = Array.isArray(VISITOR_PURPOSES)
  ? VISITOR_PURPOSES
  : ["Guest", "Delivery", "Domestic Help", "Vendor", "Cab", "Other"];
const S = {
  filters: {
    display: "grid",
    gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
    gap: 10,
    marginBottom: 16,
  },
  filterItem: { display: "flex", flexDirection: "column", gap: 4 },
  filterLabel: { fontSize: 12, fontWeight: 600, color: tokens.sub },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: {
    textAlign: "left",
    padding: "10px 12px",
    fontSize: 12,
    color: tokens.sub,
    borderBottom: tokens.border,
    whiteSpace: "nowrap",
  },
  td: {
    padding: "10px 12px",
    borderBottom: "1px solid #f3f4f6",
    verticalAlign: "middle",
  },
  visitorCell: { display: "flex", alignItems: "center", gap: 10 },
  vname: { fontWeight: 600, color: tokens.text },
  vphone: { fontSize: 12, color: tokens.sub },
  center: { display: "flex", justifyContent: "center", padding: 48 },
  pager: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 14,
  },
  pageInfo: { fontSize: 13, color: tokens.sub },
  resultMeta: { fontSize: 13, color: tokens.sub, marginBottom: 10 },
};
export default function AdminVisitorLog() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [f, setF] = useState({
    q: "",
    status: "",
    purpose: "",
    entry: "",
    from: "",
    to: "",
  });
  const set = (k, v) => {
    setPage(1);
    setF((prev) => ({ ...prev, [k]: v }));
  };
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (f.q) params.set("q", f.q);
      if (f.status) params.set("status", f.status);
      if (f.purpose) params.set("purpose", f.purpose);
      if (f.from) params.set("from", f.from);
      if (f.to) params.set("to", f.to);
      if (f.entry === "offline") params.set("offline", "1");
      const data = await api("/api/admin/visitors?" + params.toString());
      setRows((data && data.visitors) || []);
      setTotal((data && data.total) || 0);
      setHasMore((data && data.hasMore) || false);
    } catch (_) {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page, f]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);
  return (
    <div>
      <PageHeader
        title="Visitor Log"
        subtitle="Complete, searchable history of every visitor"
      />
      <Card>
        <div style={S.filters}>
          <div style={S.filterItem}>
            <label style={S.filterLabel}>Search</label>
            <Input
              placeholder="Name, phone or vehicle"
              value={f.q}
              onChange={(e) => set("q", e.target.value)}
            />
          </div>
          <div style={S.filterItem}>
            <label style={S.filterLabel}>Status</label>
            <Select
              value={f.status}
              onChange={(e) => set("status", e.target.value)}
            >
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
          <div style={S.filterItem}>
            <label style={S.filterLabel}>Purpose</label>
            <Select
              value={f.purpose}
              onChange={(e) => set("purpose", e.target.value)}
            >
              <option value="">All</option>
              {PURPOSES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </div>
          <div style={S.filterItem}>
            <label style={S.filterLabel}>From</label>
            <Input
              type="date"
              value={f.from}
              onChange={(e) => set("from", e.target.value)}
            />
          </div>
          <div style={S.filterItem}>
            <label style={S.filterLabel}>To</label>
            <Input
              type="date"
              value={f.to}
              onChange={(e) => set("to", e.target.value)}
            />
          </div>
          <div style={S.filterItem}>
            <label style={S.filterLabel}>Entry</label>
            <Select
              value={f.entry}
              onChange={(e) => set("entry", e.target.value)}
            >
              <option value="">All</option>
              <option value="offline">Offline only</option>
            </Select>
          </div>
        </div>
        <div style={S.resultMeta}>
          {total} result{total === 1 ? "" : "s"}
        </div>
        {loading ? (
          <div style={S.center}>
            <Spinner size={28} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="🔍"
            title="No matching visitors"
            subtitle="Try adjusting the filters."
          />
        ) : (
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Visitor</th>
                  <th style={S.th}>Purpose</th>
                  <th style={S.th}>Flat</th>
                  <th style={S.th}>Vehicle</th>
                  <th style={S.th}>Logged by</th>
                  <th style={S.th}>Time</th>
                  <th style={S.th}>Status</th>
                  <th style={S.th}>Entry</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v._id}>
                    <td style={S.td}>
                      <div style={S.visitorCell}>
                        <Avatar src={v.photo} name={v.name} size={34} />
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
                      {v.memberId && v.memberId.wing
                        ? v.memberId.wing + "-"
                        : ""}
                      {(v.memberId && v.memberId.flatNo) || "—"}
                    </td>
                    <td style={S.td}>{v.vehicleNumber || "—"}</td>
                    <td style={S.td}>
                      {(v.enteredBy && v.enteredBy.name) || "—"}
                    </td>
                    <td style={S.td}>{fmtTime(v.entryTime || v.createdAt)}</td>
                    <td style={S.td}>
                      <StatusBadge status={v.status} />
                    </td>
                    <td style={S.td}>
                      {v.entryMethod === "OfflineEntry" ? (
                        <span
                          title={(v.offlineMeta && v.offlineMeta.note) || ""}
                        >
                          📴 Offline
                          {v.offlineMeta && v.offlineMeta.confirmation
                            ? ` · ${v.offlineMeta.confirmation.status}`
                            : ""}
                        </span>
                      ) : (
                        "Online"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={S.pager}>
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ← Prev
          </Button>
          <span style={S.pageInfo}>Page {page}</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={!hasMore}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </Button>
        </div>
      </Card>
    </div>
  );
}

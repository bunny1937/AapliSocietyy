"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card, PageHeader, Button, Badge, Spinner, Toast, EmptyState,
  Modal, StatCard, tokens, fmtTime, grid,
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

const SECTION_LABELS = {
  Contact: "Contact",
  FamilyMember: "Family member",
  EmergencyContact: "Emergency contact",
  Parking: "Parking",
};
const STATUS_COLOR = { Pending: "#92400e", Approved: "#166534", Rejected: "#991b1b" };
const TABS = ["Pending", "Approved", "Rejected", "All"];
const DASH = "\u2014";

function describePayload(item) {
  const { section, action, payload = {} } = item;
  if (section === "Contact") {
    return Object.entries(payload).map(([k, v]) => `${k}: ${v}`).join(" / ") || DASH;
  }
  if (section === "EmergencyContact") {
    return `${payload.name || DASH} (${payload.relation || DASH}) / ${payload.phoneNumber || DASH}${payload.address ? ` / ${payload.address}` : ""}`;
  }
  if (section === "Parking") {
    if (action === "Remove") return `Remove parking slot ${payload.slotNumber || payload.slotId || ""}`.trim();
    return [payload.slotNumber && `Slot ${payload.slotNumber}`, payload.type, payload.vehicleType].filter(Boolean).join(" / ") || DASH;
  }
  if (action === "Remove") return "Remove this family member";
  return `${payload.name || DASH} / ${payload.relation || DASH}${payload.age ? ` / ${payload.age} yrs` : ""}`;
}

const S = {
  card: { border: `1px solid ${tokens.border}`, borderRadius: 12, padding: 16, display: "grid", gap: 10, background: "#fff" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  name: { fontWeight: 800, fontSize: 14.5, color: tokens.text },
  meta: { fontSize: 12.5, color: tokens.sub, marginTop: 3 },
  body: { fontSize: 13, color: tokens.text },
  actions: { display: "flex", gap: 8, flexWrap: "wrap" },
  tabs: { display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" },
  tab: (on) => ({
    padding: "7px 14px", borderRadius: 20,
    border: `1px solid ${on ? tokens.primary : tokens.border}`,
    background: on ? tokens.primary : "#fff",
    color: on ? "#fff" : tokens.sub,
    fontWeight: 600, fontSize: 13, cursor: "pointer",
  }),
  search: { marginLeft: "auto", padding: "7px 12px", borderRadius: 8, border: `1px solid ${tokens.border}`, fontSize: 13, minWidth: 220 },
  center: { display: "flex", justifyContent: "center", padding: 48 },
  pre: { background: "#f9fafb", border: `1px solid ${tokens.border}`, borderRadius: 8, padding: 12, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" },
};

export default function ProfileChangesPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [tab, setTab] = useState("Pending");
  const [detail, setDetail] = useState(null);
  const [q, setQ] = useState("");

  // Pull every status so the tabs filter client-side and counters stay honest.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api("/api/admin/profile-edit-requests?status=all");
      setItems(data.items || []);
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => ({
    Pending: items.filter((i) => i.status === "Pending").length,
    Approved: items.filter((i) => i.status === "Approved").length,
    Rejected: items.filter((i) => i.status === "Rejected").length,
  }), [items]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items
      .filter((i) => (tab === "All" ? true : i.status === tab))
      .filter((i) => {
        if (!term) return true;
        return [i.member && i.member.ownerName, i.member && i.member.flatNo, i.member && i.member.wing, i.section, i.action]
          .filter(Boolean).join(" ").toLowerCase().includes(term);
      });
  }, [items, tab, q]);

  async function approve(id) {
    setBusyId(id);
    try {
      await api(`/api/admin/profile-edit-requests/${id}/approve`, { method: "POST" });
      setToast({ type: "success", message: "Change approved" });
      setDetail(null); load();
    } catch (err) { setToast({ type: "error", message: err.message }); }
    finally { setBusyId(null); }
  }

  async function reject(id) {
    const reason = window.prompt("Reason for rejection (shown to the owner):", "");
    if (reason === null) return;
    setBusyId(id);
    try {
      await api(`/api/admin/profile-edit-requests/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
      setToast({ type: "success", message: "Request rejected" });
      setDetail(null); load();
    } catch (err) { setToast({ type: "error", message: err.message }); }
    finally { setBusyId(null); }
  }

  return (
    <div>
      <PageHeader
        title="Profile Changes"
        subtitle="Contact, family, emergency contact and parking changes submitted from the mobile app."
        actions={<Button variant="ghost" onClick={load}>Refresh</Button>}
      />

      <div style={{ ...grid(200), marginBottom: 18 }}>
        <StatCard label="Pending" value={counts.Pending} color="#d97706" />
        <StatCard label="Approved" value={counts.Approved} color="#16a34a" />
        <StatCard label="Rejected" value={counts.Rejected} color="#dc2626" />
      </div>

      <div style={S.tabs}>
        {TABS.map((t) => (
          <button key={t} style={S.tab(tab === t)} onClick={() => setTab(t)}>
            {t}{t !== "All" ? ` (${counts[t] || 0})` : ""}
          </button>
        ))}
        <input style={S.search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search flat or owner..." />
      </div>

      {loading ? (
        <Card><div style={S.center}><Spinner /></div></Card>
      ) : visible.length === 0 ? (
        <Card><EmptyState title="Nothing here" subtitle="No requests match this filter." /></Card>
      ) : (
        <div style={grid(320)}>
          {visible.map((item) => (
            <div key={item._id} style={S.card}>
              <div style={S.head}>
                <div>
                  <div style={S.name}>
                    {(item.member && item.member.ownerName) || DASH} / {(item.member && item.member.flatNo) || DASH}
                    {item.member && item.member.wing ? ` (${item.member.wing})` : ""}
                  </div>
                  <div style={S.meta}>
                    {SECTION_LABELS[item.section] || item.section} / {item.action}
                    {item.createdAt ? ` / ${fmtTime(item.createdAt)}` : ""}
                  </div>
                </div>
                <Badge color={STATUS_COLOR[item.status] || tokens.sub}>{item.status}</Badge>
              </div>

              <div style={S.body}>{describePayload(item)}</div>

              <div style={S.actions}>
                <Button size="sm" variant="ghost" onClick={() => setDetail(item)}>Show details</Button>
                {item.status === "Pending" && (
                  <>
                    <Button size="sm" disabled={busyId === item._id} onClick={() => approve(item._id)}>Approve</Button>
                    <Button size="sm" variant="ghost" disabled={busyId === item._id} onClick={() => reject(item._id)}>Reject</Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(detail)}
        title={detail ? `${SECTION_LABELS[detail.section] || detail.section} / ${detail.action}` : ""}
        onClose={() => setDetail(null)}
        width={560}
        footer={detail && detail.status === "Pending" ? (
          <div style={{ display: "flex", gap: 8 }}>
            <Button disabled={busyId === detail._id} onClick={() => approve(detail._id)}>Approve</Button>
            <Button variant="ghost" disabled={busyId === detail._id} onClick={() => reject(detail._id)}>Reject</Button>
          </div>
        ) : null}
      >
        {detail && (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={S.meta}>
              {(detail.member && detail.member.ownerName) || DASH} / flat {(detail.member && detail.member.flatNo) || DASH}
              {detail.createdAt ? ` / submitted ${fmtTime(detail.createdAt)}` : ""}
            </div>
            <div style={S.body}>{describePayload(detail)}</div>
            {detail.rejectionReason && (
              <div style={{ fontSize: 12.5, color: "#991b1b", fontWeight: 600 }}>
                Rejection reason: {detail.rejectionReason}
              </div>
            )}
            <div style={S.pre}>{JSON.stringify(detail.payload || {}, null, 2)}</div>
          </div>
        )}
      </Modal>

      {toast ? <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} /> : null}
    </div>
  );
}

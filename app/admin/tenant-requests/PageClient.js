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

const DOCUMENT_FIELDS = [
  { field: "contract", label: "Lease contract" },
  { field: "signature", label: "Signature" },
  { field: "aadhaar", label: "Aadhaar card" },
  { field: "policeVerification", label: "Police verification" },
];
const TABS = ["Requests", "Active", "Inactive", "All"];
const STATE_COLOR = { Active: "#166534", Requests: "#92400e", Inactive: "#6b7280" };
const DASH = "\u2014";

const S = {
  card: { border: `1px solid ${tokens.border}`, borderRadius: 12, padding: 16, display: "grid", gap: 10, background: "#fff" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  flat: { fontWeight: 800, fontSize: 15, color: tokens.text },
  meta: { fontSize: 12.5, color: tokens.sub, marginTop: 3 },
  tenant: { fontSize: 13, color: tokens.text, fontWeight: 600 },
  actions: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 },
  tabs: { display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" },
  tab: (on) => ({
    padding: "7px 14px", borderRadius: 20,
    border: `1px solid ${on ? tokens.primary : tokens.border}`,
    background: on ? tokens.primary : "#fff",
    color: on ? "#fff" : tokens.sub,
    fontWeight: 600, fontSize: 13, cursor: "pointer",
  }),
  search: { marginLeft: "auto", padding: "7px 12px", borderRadius: 8, border: `1px solid ${tokens.border}`, fontSize: 13, minWidth: 240 },
  dl: { display: "grid", gridTemplateColumns: "140px 1fr", gap: "6px 12px", fontSize: 13 },
  dt: { color: tokens.sub },
  dd: { color: tokens.text, fontWeight: 600 },
  center: { display: "flex", justifyContent: "center", padding: 48 },
  section: { fontWeight: 700, fontSize: 13, color: tokens.text, marginTop: 8, marginBottom: 6 },
};

function d(v) {
  if (!v) return DASH;
  const p = new Date(v);
  return Number.isNaN(p.getTime()) ? DASH : p.toLocaleDateString("en-IN");
}

export default function ManageTenantsPage() {
  const [flats, setFlats] = useState([]);
  const [summary, setSummary] = useState({ active: 0, requests: 0, inactive: 0 });
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [tab, setTab] = useState("Requests");
  const [detail, setDetail] = useState(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api("/api/admin/tenants");
      setFlats(data.flats || []);
      setSummary(data.summary || { active: 0, requests: 0, inactive: 0 });
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return flats
      .filter((f) => (tab === "All" ? true : f.state === tab))
      .filter((f) => {
        if (!term) return true;
        return [f.flatNo, f.wing, f.ownerName, f.currentTenant && f.currentTenant.name,
          ...(f.pendingRequests || []).map((r) => r.tenantName)]
          .filter(Boolean).join(" ").toLowerCase().includes(term);
      });
  }, [flats, tab, q]);

  async function viewDocument(requestId, field) {
    try {
      const data = await api(`/api/admin/tenant-requests/${requestId}/documents/${field}`);
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) { setToast({ type: "error", message: err.message }); }
  }

  async function approve(id) {
    setBusyId(id);
    try {
      const data = await api(`/api/admin/tenant-requests/${id}/approve`, { method: "POST" });
      setToast({ type: "success", message: `Approved. Username: ${data.username}${data.emailDelivered ? "" : " (email not sent - check email provider config)"}` });
      setDetail(null); load();
    } catch (err) { setToast({ type: "error", message: err.message }); }
    finally { setBusyId(null); }
  }

  async function reject(id) {
    const reason = window.prompt("Reason for rejection (shown to the owner):", "");
    if (reason === null) return;
    setBusyId(id);
    try {
      await api(`/api/admin/tenant-requests/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
      setToast({ type: "success", message: "Request rejected" });
      setDetail(null); load();
    } catch (err) { setToast({ type: "error", message: err.message }); }
    finally { setBusyId(null); }
  }

  // Admin half of the two-party move-out. The owner ends the lease from the
  // app; this closes the tenancy and disables the tenant login.
  async function confirmMoveOut(id) {
    if (!window.confirm("Close this tenancy and disable the tenant login?")) return;
    setBusyId(id);
    try {
      await api(`/api/admin/tenant-requests/${id}/confirm-move-out`, { method: "POST" });
      setToast({ type: "success", message: "Tenancy closed" });
      setDetail(null); load();
    } catch (err) { setToast({ type: "error", message: err.message }); }
    finally { setBusyId(null); }
  }

  return (
    <div>
      <PageHeader
        title="Manage Tenants"
        subtitle="Flat-wise view of every tenancy: live tenants, pending onboarding requests, and past tenants."
        actions={<Button variant="ghost" onClick={load}>Refresh</Button>}
      />

      <div style={{ ...grid(200), marginBottom: 18 }}>
        <StatCard label="Active tenancies" value={summary.active} color="#16a34a" />
        <StatCard label="Awaiting approval" value={summary.requests} color="#d97706" />
        <StatCard label="Flats without a tenant" value={summary.inactive} color="#6b7280" />
      </div>

      <div style={S.tabs}>
        {TABS.map((t) => (
          <button key={t} style={S.tab(tab === t)} onClick={() => setTab(t)}>{t}</button>
        ))}
        <input style={S.search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search flat, owner or tenant..." />
      </div>

      {loading ? (
        <Card><div style={S.center}><Spinner /></div></Card>
      ) : visible.length === 0 ? (
        <Card><EmptyState title="Nothing here" subtitle="No flats match this filter." /></Card>
      ) : (
        <div style={grid(320)}>
          {visible.map((f) => {
            const live = f.currentTenant;
            const pending = f.pendingRequests || [];
            return (
              <div key={f.memberId} style={S.card}>
                <div style={S.head}>
                  <div>
                    <div style={S.flat}>{f.wing ? `${f.wing}-` : ""}{f.flatNo || DASH}</div>
                    <div style={S.meta}>Owner: {f.ownerName || DASH}{f.ownershipType ? ` / ${f.ownershipType}` : ""}</div>
                  </div>
                  <Badge color={STATE_COLOR[f.state]}>{f.state}</Badge>
                </div>

                {live ? (
                  <div>
                    <div style={S.tenant}>{live.name || "Tenant"}</div>
                    <div style={S.meta}>
                      {live.contactNumber || live.phoneNumber || live.phone || DASH}
                      {live.rentPerMonth ? ` / Rs ${live.rentPerMonth}/mo` : ""}
                      <br />
                      Lease {d(live.leaseStartDate)} to {d(live.leaseEndDate)}
                    </div>
                  </div>
                ) : (
                  <div style={S.meta}>No live tenancy on this flat.</div>
                )}

                {pending.length > 0 && (
                  <div style={{ ...S.meta, color: "#92400e", fontWeight: 700 }}>
                    {pending.length} request{pending.length > 1 ? "s" : ""} awaiting approval
                  </div>
                )}
                {f.counts.past > 0 && <div style={S.meta}>{f.counts.past} past tenant(s) on record</div>}

                <div style={S.actions}>
                  <Button size="sm" variant="ghost" onClick={() => setDetail({ flat: f, request: null })}>Show details</Button>
                  {pending.map((r) => (
                    <Button key={r._id} size="sm" onClick={() => setDetail({ flat: f, request: r })}>
                      Review {r.tenantName || "request"}
                    </Button>
                  ))}
                  {live && f.activeRequest && (
                    <Button size="sm" variant="ghost" disabled={busyId === f.activeRequest._id}
                      onClick={() => confirmMoveOut(f.activeRequest._id)}>Close tenancy</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={Boolean(detail)}
        title={detail ? `${detail.flat.wing ? `${detail.flat.wing}-` : ""}${detail.flat.flatNo || ""} tenancy` : ""}
        onClose={() => setDetail(null)}
        width={620}
        footer={detail && detail.request && detail.request.status === "Pending" ? (
          <div style={{ display: "flex", gap: 8 }}>
            <Button disabled={busyId === detail.request._id} onClick={() => approve(detail.request._id)}>Approve and create login</Button>
            <Button variant="ghost" disabled={busyId === detail.request._id} onClick={() => reject(detail.request._id)}>Reject</Button>
          </div>
        ) : null}
      >
        {detail && (
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <div style={S.section}>Flat</div>
              <div style={S.dl}>
                <div style={S.dt}>Owner</div><div style={S.dd}>{detail.flat.ownerName || DASH}</div>
                <div style={S.dt}>Ownership</div><div style={S.dd}>{detail.flat.ownershipType || DASH}</div>
              </div>
            </div>

            {detail.flat.currentTenant && (
              <div>
                <div style={S.section}>Current tenant</div>
                <div style={S.dl}>
                  <div style={S.dt}>Name</div><div style={S.dd}>{detail.flat.currentTenant.name || DASH}</div>
                  <div style={S.dt}>Phone</div><div style={S.dd}>{detail.flat.currentTenant.contactNumber || detail.flat.currentTenant.phoneNumber || detail.flat.currentTenant.phone || DASH}</div>
                  <div style={S.dt}>Email</div><div style={S.dd}>{detail.flat.currentTenant.email || DASH}</div>
                  <div style={S.dt}>Rent</div><div style={S.dd}>{detail.flat.currentTenant.rentAmount ? `Rs ${detail.flat.currentTenant.rentAmount}/mo` : DASH}</div>
                  <div style={S.dt}>Deposit</div><div style={S.dd}>{detail.flat.currentTenant.depositAmount ? `Rs ${detail.flat.currentTenant.depositAmount}` : DASH}</div>
                  <div style={S.dt}>Lease</div><div style={S.dd}>{d(detail.flat.currentTenant.leaseStartDate)} to {d(detail.flat.currentTenant.leaseEndDate)}</div>
                </div>
              </div>
            )}

            {detail.request && (
              <div>
                <div style={S.section}>Request under review</div>
                <div style={S.dl}>
                  <div style={S.dt}>Tenant</div><div style={S.dd}>{detail.request.tenantName || DASH}</div>
                  <div style={S.dt}>Phone</div><div style={S.dd}>{detail.request.tenantPhone || DASH}</div>
                  <div style={S.dt}>Email</div><div style={S.dd}>{detail.request.tenantEmail || DASH}</div>
                  <div style={S.dt}>Rent</div><div style={S.dd}>{detail.request.rentPerMonth ? `Rs ${detail.request.rentPerMonth}/mo` : DASH}</div>
                  <div style={S.dt}>Lease</div><div style={S.dd}>{d(detail.request.leaseStartDate)} to {d(detail.request.leaseEndDate)}</div>
                  <div style={S.dt}>Submitted</div><div style={S.dd}>{detail.request.createdAt ? fmtTime(detail.request.createdAt) : DASH}</div>
                </div>

                {detail.request.pendingLeaseChange && detail.request.pendingLeaseChange.status === "Pending" && (
                  <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "#fef3c7", color: "#92400e", fontSize: 12.5, fontWeight: 600 }}>
                    Owner proposed new lease dates: {d(detail.request.pendingLeaseChange.leaseStartDate)} to {d(detail.request.pendingLeaseChange.leaseEndDate)}
                  </div>
                )}

                <div style={S.section}>Documents</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {DOCUMENT_FIELDS.map(({ field, label }) => (
                    <Button key={field} variant="ghost" size="sm" onClick={() => viewDocument(detail.request._id, field)}>
                      View {label}
                    </Button>
                  ))}
                </div>

                {(detail.request.notes || []).length > 0 && (
                  <div>
                    <div style={S.section}>Owner notes</div>
                    <div style={{ display: "grid", gap: 5 }}>
                      {detail.request.notes.map((n, i) => (
                        <div key={i} style={{ fontSize: 12.5, color: tokens.sub }}>
                          {n.text} - {n.by || "Owner"}{n.at ? `, ${fmtTime(n.at)}` : ""}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {(detail.flat.pastTenants || []).length > 0 && (
              <div>
                <div style={S.section}>Past tenants</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {detail.flat.pastTenants.map((p, i) => (
                    <div key={i} style={{ fontSize: 12.5, color: tokens.sub }}>
                      {p.name || DASH} / {d(p.leaseStartDate)} to {d(p.leaseEndDate)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {toast ? <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} /> : null}
    </div>
  );
}

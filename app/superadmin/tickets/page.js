"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import notify from "@/lib/notify";
import {
  TICKET_CATEGORIES,
  TICKET_STATUSES,
  STATUS_TONE,
} from "@/lib/support/ticketPolicy";

const STATUS_COLOR_VAR = {
  info: "var(--info, #2563eb)",
  warning: "var(--warning, #b45309)",
  success: "var(--success, #059669)",
  danger: "var(--danger, #dc2626)",
};

async function adminFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export default function SuperAdminTicketsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [selected, setSelected] = useState(null);
  const [statusDraft, setStatusDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");

  // A ticket-notification email links to ?open=<id> — open that ticket's
  // detail automatically on arrival. Reads window.location directly (not
  // next/navigation's useSearchParams) so this page doesn't need a Suspense
  // boundary — same reasoning as app/auth/login/page.js's own comment.
  useEffect(() => {
    const openId = new URLSearchParams(window.location.search).get("open");
    if (openId) setSelected(openId);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["superadmin-tickets", filterStatus, filterCategory, search],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filterStatus !== "all") params.set("status", filterStatus);
      if (filterCategory !== "all") params.set("category", filterCategory);
      if (search.trim()) params.set("q", search.trim());
      return adminFetch(`/api/superadmin/tickets?${params.toString()}`);
    },
  });

  const detailQuery = useQuery({
    queryKey: ["superadmin-ticket-detail", selected],
    queryFn: () => adminFetch(`/api/superadmin/tickets/${selected}`),
    enabled: Boolean(selected),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status, note }) =>
      adminFetch(`/api/superadmin/tickets/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, note }),
      }),
    onSuccess: () => {
      notify.success("Status updated");
      setNoteDraft("");
      qc.invalidateQueries({ queryKey: ["superadmin-tickets"] });
      qc.invalidateQueries({ queryKey: ["superadmin-ticket-detail", selected] });
    },
    onError: (err) => notify.error(err.message),
  });

  const tickets = data?.tickets || [];

  return (
    <div style={{ padding: "2rem", maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" }}>Support Tickets</h1>
      <p style={{ color: "var(--fg-4)", marginBottom: "2rem" }}>
        Every ticket raised by a society admin, across every society.
      </p>

      <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <input
          placeholder="Search title, society, admin…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "0.5rem", borderRadius: 6, border: "1px solid var(--border)", flex: 1, minWidth: 200 }}
        />
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} style={selectStyle}>
          <option value="all">All Categories</option>
          {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={selectStyle}>
          <option value="all">All Status</option>
          {TICKET_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span style={{ padding: "0.5rem 1rem", background: "var(--info-bg)", borderRadius: 20, fontWeight: 600, color: "var(--info)" }}>
          {tickets.length} Tickets
        </span>
      </div>

      {isLoading ? (
        <div style={{ padding: "3rem", textAlign: "center", color: "var(--fg-4)" }}>Loading tickets…</div>
      ) : tickets.length === 0 ? (
        <div style={{ padding: "3rem", textAlign: "center", color: "var(--fg-4)" }}>No tickets found.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ background: "var(--bg-sunken)", borderBottom: "2px solid var(--border)" }}>
                {["Society", "Admin", "Category", "Title", "Submitted", "Status", ""].map((h) => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "var(--fg-3)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} style={{ borderBottom: "1px solid var(--bg-muted)" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 600 }}>{t.societyName}</td>
                  <td style={{ padding: "10px 12px" }}>{t.submittedByName}</td>
                  <td style={{ padding: "10px 12px" }}>{t.category}</td>
                  <td style={{ padding: "10px 12px" }}>{t.title}</td>
                  <td style={{ padding: "10px 12px" }}>{new Date(t.createdAt).toLocaleDateString("en-IN")}</td>
                  <td style={{ padding: "10px 12px" }}><StatusPill status={t.status} /></td>
                  <td style={{ padding: "10px 12px" }}>
                    <button
                      onClick={() => { setSelected(t.id); setStatusDraft(t.status); }}
                      style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--info)", color: "var(--info)", background: "var(--bg-surface)", cursor: "pointer", fontSize: "0.8rem" }}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}
          onClick={() => setSelected(null)}
        >
          <div
            style={{ background: "var(--bg-surface)", borderRadius: 12, maxWidth: 700, width: "100%", maxHeight: "90vh", overflowY: "auto", padding: "2rem" }}
            onClick={(e) => e.stopPropagation()}
          >
            {detailQuery.isLoading || !detailQuery.data ? (
              <div style={{ padding: "2rem", textAlign: "center", color: "var(--fg-4)" }}>Loading…</div>
            ) : (
              <TicketDetail
                ticket={detailQuery.data.ticket}
                statusDraft={statusDraft}
                onStatusDraft={setStatusDraft}
                noteDraft={noteDraft}
                onNoteDraft={setNoteDraft}
                onSave={() =>
                  statusMutation.mutate({ id: detailQuery.data.ticket._id, status: statusDraft, note: noteDraft })
                }
                saving={statusMutation.isPending}
                onClose={() => setSelected(null)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }) {
  const tone = STATUS_TONE[status] || "info";
  const color = STATUS_COLOR_VAR[tone];
  return (
    <span style={{ padding: "3px 10px", borderRadius: 12, fontSize: "0.8rem", fontWeight: 700, background: `${color}22`, color, whiteSpace: "nowrap" }}>
      {status}
    </span>
  );
}

function TicketDetail({ ticket, statusDraft, onStatusDraft, noteDraft, onNoteDraft, onSave, saving, onClose }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: "1.25rem" }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--fg-5)", marginBottom: 4 }}>{ticket.category}</div>
          <h2 style={{ fontWeight: 700, fontSize: "1.2rem" }}>{ticket.title}</h2>
        </div>
        <StatusPill status={ticket.status} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1.25rem", fontSize: "0.875rem" }}>
        {[
          ["Society", ticket.societyName],
          ["Submitted by", ticket.submittedByName],
          ["Submitted", new Date(ticket.createdAt).toLocaleString("en-IN")],
          ["Last updated", new Date(ticket.updatedAt).toLocaleString("en-IN")],
        ].map(([l, v]) => (
          <div key={l} style={{ background: "var(--bg-sunken)", padding: "0.6rem 0.75rem", borderRadius: 6 }}>
            <div style={{ fontSize: "0.75rem", color: "var(--fg-4)" }}>{l}</div>
            <div style={{ fontWeight: 600 }}>{v}</div>
          </div>
        ))}
      </div>

      <p style={{ whiteSpace: "pre-wrap", color: "var(--fg-2)", marginBottom: "1.25rem", fontSize: 14 }}>
        {ticket.description}
      </p>

      {ticket.errorLogs && (
        <div style={{ marginBottom: "1.25rem" }}>
          <div style={labelStyle}>Error logs</div>
          <pre style={{
            background: "var(--bg-sunken)", padding: "0.75rem", borderRadius: 8, fontSize: 12,
            maxHeight: 220, overflow: "auto", whiteSpace: "pre-wrap", userSelect: "none",
          }}>
            {ticket.errorLogs}
          </pre>
        </div>
      )}

      {ticket.screenshots?.length > 0 && (
        <div style={{ marginBottom: "1.25rem" }}>
          <div style={labelStyle}>Screenshots</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {ticket.screenshots.map((s, i) => (
              <img
                key={i}
                src={s.data}
                alt={s.filename || `screenshot ${i + 1}`}
                onContextMenu={(e) => e.preventDefault()}
                style={{ maxWidth: 280, maxHeight: 200, borderRadius: 8, border: "1px solid var(--border)" }}
              />
            ))}
          </div>
        </div>
      )}

      <div style={{ marginBottom: "1.25rem" }}>
        <div style={labelStyle}>Status history</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {ticket.statusHistory?.map((h, i) => (
            <div key={i} style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <StatusPill status={h.status} />
              <span style={{ color: "var(--fg-5)", fontSize: 12 }}>
                {new Date(h.changedAt).toLocaleString("en-IN")}
                {h.changedByName ? ` · ${h.changedByName}` : ""}
              </span>
              {h.note && <span style={{ color: "var(--fg-3)" }}>— {h.note}</span>}
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: "var(--bg-sunken)", borderRadius: 8, padding: "1rem", marginBottom: "1rem" }}>
        <div style={labelStyle}>Update status</div>
        <div style={{ display: "flex", gap: "0.75rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
          {TICKET_STATUSES.map((s) => (
            <label key={s} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
              <input type="radio" name="status" checked={statusDraft === s} onChange={() => onStatusDraft(s)} />
              {s}
            </label>
          ))}
        </div>
        <textarea
          value={noteDraft}
          onChange={(e) => onNoteDraft(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="Optional note for the society admin (they'll see this on their ticket)"
          style={{ width: "100%", padding: "0.6rem", borderRadius: 6, border: "1px solid var(--border)", resize: "vertical", boxSizing: "border-box" }}
        />
      </div>

      <div style={{ display: "flex", gap: "0.75rem" }}>
        <button
          onClick={onSave}
          disabled={saving || (statusDraft === ticket.status && !noteDraft.trim())}
          style={{ padding: "0.6rem 1.5rem", background: "var(--primary)", color: "#fff", borderRadius: 6, border: "none", cursor: "pointer", fontWeight: 600 }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={onClose}
          style={{ padding: "0.6rem 1.25rem", background: "var(--bg-muted)", color: "var(--fg-3)", borderRadius: 6, border: "none", cursor: "pointer" }}
        >
          Close
        </button>
      </div>
    </>
  );
}

const labelStyle = { display: "block", fontWeight: 600, fontSize: 13, marginBottom: 8, color: "var(--fg-2)" };
const selectStyle = { padding: "0.5rem", borderRadius: 6, border: "1px solid var(--border)" };

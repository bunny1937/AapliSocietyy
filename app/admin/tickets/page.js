"use client";
import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import notify from "@/lib/notify";
import {
  TICKET_CATEGORIES,
  MAX_SCREENSHOTS,
  MAX_SCREENSHOT_BYTES,
  ACCEPTED_SCREENSHOT_TYPES,
  MAX_TITLE_CHARS,
  MAX_DESCRIPTION_CHARS,
  MAX_ERROR_LOG_CHARS,
  STATUS_TONE,
} from "@/lib/support/ticketPolicy";

const STATUS_COLOR_VAR = {
  info: "var(--info, #2563eb)",
  warning: "var(--warning, #b45309)",
  success: "var(--success, #059669)",
  danger: "var(--danger, #dc2626)",
};

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const EMPTY_FORM = { category: TICKET_CATEGORIES[0], title: "", description: "", errorLogs: "" };

export default function AdminTicketsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);
  const [screenshots, setScreenshots] = useState([]); // [{ data, filename, size }]
  const [selected, setSelected] = useState(null); // ticket id whose detail is open
  const fileInputRef = useRef(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-tickets"],
    queryFn: () => apiFetch("/api/admin/tickets"),
  });

  const detailQuery = useQuery({
    queryKey: ["admin-ticket-detail", selected],
    queryFn: () => apiFetch(`/api/admin/tickets/${selected}`),
    enabled: Boolean(selected),
  });

  const createMutation = useMutation({
    mutationFn: (payload) => apiFetch("/api/admin/tickets", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      notify.success("Ticket submitted");
      setForm(EMPTY_FORM);
      setScreenshots([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["admin-tickets"] });
    },
    onError: (err) => notify.error(err.message),
  });

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    if (screenshots.length + files.length > MAX_SCREENSHOTS) {
      notify.error(`Maximum ${MAX_SCREENSHOTS} screenshots allowed`);
      e.target.value = "";
      return;
    }
    for (const file of files) {
      if (!ACCEPTED_SCREENSHOT_TYPES.includes(file.type)) {
        notify.error(`${file.name}: only PNG, JPEG, WebP allowed`);
        continue;
      }
      if (file.size > MAX_SCREENSHOT_BYTES) {
        notify.error(`${file.name} is ${Math.round(file.size / 1024)}KB — max is ${MAX_SCREENSHOT_BYTES / 1024}KB`);
        continue;
      }
      const data = await readFileAsDataUrl(file);
      setScreenshots((prev) => [...prev, { data, filename: file.name, size: file.size }]);
    }
    e.target.value = "";
  }

  function removeScreenshot(i) {
    setScreenshots((prev) => prev.filter((_, idx) => idx !== i));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (form.title.trim().length < 5) return notify.error(`Title must be at least 5 characters`);
    if (form.description.trim().length < 10) return notify.error("Description must be at least 10 characters");
    createMutation.mutate({
      ...form,
      screenshots: screenshots.map((s) => ({ data: s.data, filename: s.filename })),
    });
  }

  const tickets = data?.tickets || [];

  return (
    <div style={{ padding: "2rem", maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.35rem" }}>Support Ticket</h1>
      <p style={{ color: "var(--fg-4)", marginBottom: "2rem" }}>
        Report a bug, an error, or ask something — this goes straight to the platform team.
      </p>

      {/* ── New ticket form ─────────────────────────────────────────── */}
      <form
        onSubmit={handleSubmit}
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "1.5rem",
          marginBottom: "2rem",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: "1rem", marginBottom: "1rem" }}>
          <div>
            <label style={labelStyle}>Category</label>
            <select
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              style={inputStyle}
            >
              {TICKET_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Title</label>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              maxLength={MAX_TITLE_CHARS}
              placeholder="One line summarising the issue"
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <label style={labelStyle}>Description</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            maxLength={MAX_DESCRIPTION_CHARS}
            rows={5}
            placeholder="What happened, what you expected, steps to reproduce…"
            style={{ ...inputStyle, resize: "vertical" }}
          />
          <div style={{ fontSize: 12, color: "var(--fg-5)", textAlign: "right" }}>
            {form.description.length}/{MAX_DESCRIPTION_CHARS}
          </div>
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <label style={labelStyle}>Error logs <span style={{ color: "var(--fg-5)", fontWeight: 400 }}>(optional — paste console/stack trace text)</span></label>
          <textarea
            value={form.errorLogs}
            onChange={(e) => setForm((f) => ({ ...f, errorLogs: e.target.value }))}
            maxLength={MAX_ERROR_LOG_CHARS}
            rows={4}
            placeholder="Paste any error text here"
            style={{ ...inputStyle, resize: "vertical", fontFamily: "ui-monospace, monospace", fontSize: 12.5 }}
          />
        </div>

        <div style={{ marginBottom: "1.25rem" }}>
          <label style={labelStyle}>
            Screenshots <span style={{ color: "var(--fg-5)", fontWeight: 400 }}>
              (optional — up to {MAX_SCREENSHOTS}, {MAX_SCREENSHOT_BYTES / 1024}KB each, PNG/JPEG/WebP)
            </span>
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_SCREENSHOT_TYPES.join(",")}
            multiple
            disabled={screenshots.length >= MAX_SCREENSHOTS}
            onChange={handleFiles}
            style={{ display: "block" }}
          />
          {screenshots.length > 0 && (
            <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              {screenshots.map((s, i) => (
                <div key={i} style={{ position: "relative", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
                  <img src={s.data} alt={s.filename} style={{ width: 100, height: 70, objectFit: "cover", display: "block" }} />
                  <button
                    type="button"
                    onClick={() => removeScreenshot(i)}
                    title="Remove"
                    style={{
                      position: "absolute", top: 2, right: 2, width: 20, height: 20, borderRadius: "50%",
                      border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", cursor: "pointer", fontSize: 12, lineHeight: "20px",
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={createMutation.isPending}
          style={{
            padding: "0.65rem 1.5rem", background: "var(--primary)", color: "#fff", border: "none",
            borderRadius: 8, fontWeight: 600, cursor: "pointer",
          }}
        >
          {createMutation.isPending ? "Submitting…" : "Submit ticket"}
        </button>
      </form>

      {/* ── My tickets ──────────────────────────────────────────────── */}
      <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.75rem" }}>My tickets</h2>
      {isLoading ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--fg-4)" }}>Loading…</div>
      ) : tickets.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--fg-4)", border: "1px dashed var(--border)", borderRadius: 8 }}>
          No tickets yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {tickets.map((t) => (
            <div
              key={t.id}
              onClick={() => setSelected(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 12, padding: "0.75rem 1rem",
                border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "var(--bg-surface)",
              }}
            >
              <StatusPill status={t.status} />
              <span style={{ fontSize: 11, color: "var(--fg-5)", minWidth: 90 }}>{t.category}</span>
              <span style={{ fontWeight: 600, flex: 1 }}>{t.title}</span>
              <span style={{ fontSize: 12, color: "var(--fg-5)" }}>
                {new Date(t.createdAt).toLocaleDateString("en-IN")}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Detail modal ────────────────────────────────────────────── */}
      {selected && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}
          onClick={() => setSelected(null)}
        >
          <div
            style={{ background: "var(--bg-surface)", borderRadius: 12, maxWidth: 640, width: "100%", maxHeight: "88vh", overflowY: "auto", padding: "2rem" }}
            onClick={(e) => e.stopPropagation()}
          >
            {detailQuery.isLoading || !detailQuery.data ? (
              <div style={{ padding: "2rem", textAlign: "center", color: "var(--fg-4)" }}>Loading…</div>
            ) : (
              <TicketDetail ticket={detailQuery.data.ticket} onClose={() => setSelected(null)} />
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
    <span style={{ padding: "3px 10px", borderRadius: 12, fontSize: "0.75rem", fontWeight: 700, background: `${color}22`, color, whiteSpace: "nowrap" }}>
      {status}
    </span>
  );
}

function TicketDetail({ ticket, onClose }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: "1rem" }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--fg-5)", marginBottom: 4 }}>{ticket.category}</div>
          <h2 style={{ fontWeight: 700, fontSize: "1.15rem" }}>{ticket.title}</h2>
        </div>
        <StatusPill status={ticket.status} />
      </div>

      <p style={{ whiteSpace: "pre-wrap", color: "var(--fg-2)", marginBottom: "1.25rem", fontSize: 14 }}>
        {ticket.description}
      </p>

      {ticket.errorLogs && (
        <div style={{ marginBottom: "1.25rem" }}>
          <div style={labelStyle}>Error logs</div>
          <pre style={{
            background: "var(--bg-sunken)", padding: "0.75rem", borderRadius: 8, fontSize: 12,
            maxHeight: 200, overflow: "auto", whiteSpace: "pre-wrap", userSelect: "none",
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
                style={{ maxWidth: 240, maxHeight: 180, borderRadius: 8, border: "1px solid var(--border)" }}
              />
            ))}
          </div>
        </div>
      )}

      <div style={{ marginBottom: "1.25rem" }}>
        <div style={labelStyle}>Status history</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {ticket.statusHistory?.map((h, i) => (
            <div key={i} style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "baseline" }}>
              <StatusPill status={h.status} />
              <span style={{ color: "var(--fg-5)", fontSize: 12 }}>
                {new Date(h.changedAt).toLocaleString("en-IN")}
              </span>
              {h.note && <span style={{ color: "var(--fg-3)" }}>— {h.note}</span>}
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={onClose}
        style={{ padding: "0.6rem 1.25rem", background: "var(--bg-muted)", color: "var(--fg-3)", borderRadius: 8, border: "none", cursor: "pointer" }}
      >
        Close
      </button>
    </>
  );
}

const labelStyle = { display: "block", fontWeight: 600, fontSize: 13, marginBottom: 6, color: "var(--fg-2)" };
const inputStyle = {
  width: "100%", padding: "0.55rem 0.7rem", borderRadius: 8, border: "1px solid var(--border-strong)",
  background: "var(--bg-input, var(--bg-surface))", color: "var(--fg-1)", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box",
};

"use client";
import { useState, useEffect, useCallback } from "react";
import styles from "@/styles/Amenities.module.css";

const STATUSES = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "CLOSED", "REJECTED"];
const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const label = (s) => (s || "").replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
const when = (d) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState([]);
  const [amenities, setAmenities] = useState([]);
  const [status, setStatus] = useState("OPEN");
  const [severity, setSeverity] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [detail, setDetail] = useState(null);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 5000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (status !== "all") params.set("status", status);
      if (severity !== "all") params.set("severity", severity);
      const res = await fetch(`/api/amenities/incidents?${params}`, { credentials: "include" });
      const data = await res.json();
      if (res.ok) setIncidents(data.incidents || []);
      else showToast(data.error || "Could not load incidents", "err");
    } finally {
      setLoading(false);
    }
  }, [status, severity]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch("/api/amenities?limit=100", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setAmenities(d.amenities || []))
      .catch(() => {});
  }, []);

  const update = async (id, body, msg) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/amenities/incidents/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update the incident");
      showToast(msg || "Updated");
      setDetail(null);
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Incidents</h1>
          <p className={styles.subtitle}>Damage, hazards, equipment failures and rule violations</p>
        </div>
      </div>

      <div className={styles.tabs}>
        {["OPEN", ...STATUSES.filter((s) => s !== "OPEN"), "all"].map((s) => (
          <button key={s} className={`${styles.tab} ${status === s ? styles.tabActive : ""}`} onClick={() => setStatus(s)}>
            {s === "all" ? "All" : label(s)}
          </button>
        ))}
      </div>

      <div className={styles.toolbar}>
        <select className={styles.select} value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="all">Any severity</option>
          {SEVERITIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : !incidents.length ? (
        <div className={styles.tableWrap}>
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>Nothing here</p>
            <p className={styles.emptyText}>No incidents match these filters.</p>
          </div>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Incident</th><th style={{ width: 150 }}>Amenity</th>
                <th style={{ width: 110 }}>Severity</th><th style={{ width: 130 }}>Status</th>
                <th style={{ width: 160 }}>Reported</th><th style={{ width: 110 }}></th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((i) => (
                <tr key={i._id}>
                  <td>
                    <div className={styles.rowName}>{i.title}</div>
                    <div className={styles.rowSub}>{i.incidentType}</div>
                  </td>
                  <td>{i.amenityName}</td>
                  <td><span className={`${styles.pill} ${styles["sev" + i.severity]}`}>{i.severity}</span></td>
                  <td><span className={`${styles.pill} ${i.status === "RESOLVED" || i.status === "CLOSED" ? styles.pillOpen : styles.pillMaint}`}>{label(i.status)}</span></td>
                  <td>
                    <div className={styles.rowSub}>{i.reportedByName || "—"}</div>
                    <div className={styles.rowSub}>{when(i.createdAt)}</div>
                  </td>
                  <td>
                    <div className={styles.actions}>
                      <button className={`${styles.btn} ${styles.btnSm}`}
                        onClick={() => setDetail({ ...i, resolutionNotes: i.resolutionNotes || "" })}>
                        Open
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div className={styles.overlay} onClick={() => setDetail(null)}>
          <div className={`${styles.modal} ${styles.modalWide}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h2 className={styles.modalTitle}>{detail.title}</h2>
              <p className={styles.subtitle} style={{ marginTop: 4 }}>
                {detail.amenityName} · {detail.incidentType} · reported by {detail.reportedByName || "—"} on {when(detail.createdAt)}
              </p>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.field}>
                <label className={styles.label}>Description</label>
                <p style={{ fontSize: 13, color: "#374151", margin: 0, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                  {detail.description}
                </p>
              </div>

              <div className={styles.grid2}>
                <div className={styles.field}>
                  <label className={styles.label}>Severity</label>
                  <select className={styles.select} value={detail.severity}
                    onChange={(e) => setDetail({ ...detail, severity: e.target.value })}>
                    {SEVERITIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                  </select>
                  <span className={styles.hint}>
                    Residents cannot set this above low — triage is the committee&apos;s call, so that a
                    genuinely critical hazard is not buried among self-declared emergencies.
                  </span>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Status</label>
                  <select className={styles.select} value={detail.status}
                    onChange={(e) => setDetail({ ...detail, status: e.target.value })}>
                    {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                  </select>
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Resolution notes</label>
                <textarea className={styles.textarea} value={detail.resolutionNotes}
                  onChange={(e) => setDetail({ ...detail, resolutionNotes: e.target.value })}
                  placeholder="What was done — the reporter is notified when this is resolved" />
              </div>

              {detail.resolutionDate ? (
                <p className={styles.hint}>Resolved {when(detail.resolutionDate)} by {detail.resolvedByName || "—"}.</p>
              ) : null}
            </div>
            <div className={styles.modalFoot}>
              <button className={styles.btn} onClick={() => setDetail(null)}>Close</button>
              <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}
                onClick={() => update(detail._id, {
                  status: detail.status,
                  severity: detail.severity,
                  resolutionNotes: detail.resolutionNotes || undefined,
                }, detail.status === "RESOLVED" ? "Incident resolved — reporter notified" : "Incident updated")}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`${styles.toast} ${toast.type === "err" ? styles.toastErr : styles.toastOk}`}>{toast.msg}</div>
      )}
    </div>
  );
}

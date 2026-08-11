"use client";
import { useState, useEffect, useCallback } from "react";
import styles from "@/styles/Amenities.module.css";

const STATUS_TABS = ["all", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
const label = (s) => (s || "").replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
const PILL = { SCHEDULED: "pillInfo", IN_PROGRESS: "pillMaint", COMPLETED: "pillOpen", CANCELLED: "pillMuted" };
const iso = (d) => d.toISOString().slice(0, 10);
const fmt = (d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default function MaintenancePage() {
  const [records, setRecords] = useState([]);
  const [amenities, setAmenities] = useState([]);
  const [status, setStatus] = useState("all");
  const [range, setRange] = useState(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    return { from: iso(from), to: iso(to) };
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [createModal, setCreateModal] = useState(null);
  const [extendModal, setExtendModal] = useState(null);
  const [reopenModal, setReopenModal] = useState(null);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 5000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to, limit: "100" });
      if (status !== "all") params.set("status", status);
      const res = await fetch(`/api/amenities/maintenance?${params}`, { credentials: "include" });
      const data = await res.json();
      if (res.ok) setRecords(data.maintenance || []);
      else showToast(data.error || "Could not load maintenance", "err");
    } finally {
      setLoading(false);
    }
  }, [status, range]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch("/api/amenities?limit=100", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setAmenities(d.amenities || []))
      .catch(() => {});
  }, []);

  const call = async (url, body, method, successMsg, close) => {
    setSaving(true);
    try {
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      showToast(successMsg);
      close?.();
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
          <h1 className={styles.title}>Maintenance</h1>
          <p className={styles.subtitle}>Schedule, extend and reopen — history is kept permanently</p>
        </div>
        <button className={`${styles.btn} ${styles.btnPrimary}`}
          disabled={!amenities.length}
          onClick={() => setCreateModal({
            amenityId: amenities[0]?._id || "", startDate: iso(new Date()),
            endDate: iso(new Date(Date.now() + 86400000)), reason: "", notes: "",
          })}>
          + Schedule maintenance
        </button>
      </div>

      <div className={styles.toolbar}>
        <input className={styles.input} type="date" value={range.from}
          onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <span className={styles.hint}>to</span>
        <input className={styles.input} type="date" value={range.to}
          onChange={(e) => setRange({ ...range, to: e.target.value })} />
      </div>

      <div className={styles.tabs}>
        {STATUS_TABS.map((s) => (
          <button key={s} className={`${styles.tab} ${status === s ? styles.tabActive : ""}`} onClick={() => setStatus(s)}>
            {s === "all" ? "All" : label(s)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : !records.length ? (
        <div className={styles.tableWrap}>
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>Nothing in this range</p>
            <p className={styles.emptyText}>Widen the dates, or schedule maintenance.</p>
          </div>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Amenity</th><th>Reason</th><th style={{ width: 210 }}>Window</th>
                <th style={{ width: 130 }}>Status</th><th style={{ width: 190 }}></th>
              </tr>
            </thead>
            <tbody>
              {records.map((m) => (
                <tr key={m._id}>
                  <td><span className={styles.rowName}>{m.amenityName}</span></td>
                  <td>
                    <div>{m.reason}</div>
                    {m.extensions?.length ? (
                      <div className={styles.rowSub}>
                        Extended {m.extensions.length}× · originally ended {fmt(m.extensions[0].previousEndDate)}
                      </div>
                    ) : null}
                    {m.reopenedEarly ? <div className={styles.rowSub}>Reopened early</div> : null}
                  </td>
                  <td>
                    {fmt(m.startDate)} – {fmt(m.actualEndDate || m.endDate)}
                    {m.actualEndDate && m.actualEndDate !== m.endDate ? (
                      <div className={styles.rowSub}>scheduled to {fmt(m.endDate)}</div>
                    ) : null}
                  </td>
                  <td>
                    <span className={`${styles.pill} ${styles[PILL[m.status] || "pillMuted"]}`}>{label(m.status)}</span>
                  </td>
                  <td>
                    <div className={styles.actions}>
                      {["SCHEDULED", "IN_PROGRESS"].includes(m.status) && (
                        <>
                          <button className={`${styles.btn} ${styles.btnSm}`}
                            onClick={() => setExtendModal({ id: m._id, name: m.amenityName, currentEnd: iso(new Date(m.endDate)), newEndDate: "", reason: "" })}>
                            Extend
                          </button>
                          <button className={`${styles.btn} ${styles.btnSm}`}
                            onClick={() => setReopenModal({ id: m._id, name: m.amenityName, notes: "" })}>
                            Reopen
                          </button>
                        </>
                      )}
                      {m.status === "SCHEDULED" && (
                        <button className={`${styles.btn} ${styles.btnSm} ${styles.btnDanger}`}
                          onClick={() => {
                            if (!confirm("Cancel this scheduled maintenance?")) return;
                            call(`/api/amenities/maintenance/${m._id}`, null, "DELETE", "Maintenance cancelled");
                          }}>
                          Cancel
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createModal && (
        <div className={styles.overlay} onClick={() => setCreateModal(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}><h2 className={styles.modalTitle}>Schedule maintenance</h2></div>
            <div className={styles.modalBody}>
              <div className={styles.field}>
                <label className={styles.label}>Amenity</label>
                <select className={styles.select} value={createModal.amenityId}
                  onChange={(e) => setCreateModal({ ...createModal, amenityId: e.target.value })}>
                  {amenities.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
                </select>
              </div>
              <div className={styles.grid2}>
                <div className={styles.field}>
                  <label className={styles.label}>Starts</label>
                  <input className={styles.input} type="date" value={createModal.startDate}
                    onChange={(e) => setCreateModal({ ...createModal, startDate: e.target.value })} />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Ends</label>
                  <input className={styles.input} type="date" value={createModal.endDate}
                    onChange={(e) => setCreateModal({ ...createModal, endDate: e.target.value })} />
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Reason</label>
                <input className={styles.input} value={createModal.reason}
                  onChange={(e) => setCreateModal({ ...createModal, reason: e.target.value })}
                  placeholder="Pool retiling" />
                <span className={styles.hint}>Residents see this, so write it for them.</span>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Internal notes</label>
                <textarea className={styles.textarea} value={createModal.notes}
                  onChange={(e) => setCreateModal({ ...createModal, notes: e.target.value })} />
              </div>
            </div>
            <div className={styles.modalFoot}>
              <button className={styles.btn} onClick={() => setCreateModal(null)}>Cancel</button>
              <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}
                onClick={() => call("/api/amenities/maintenance", createModal, "POST",
                  "Maintenance scheduled — residents notified", () => setCreateModal(null))}>
                {saving ? "Saving…" : "Schedule"}
              </button>
            </div>
          </div>
        </div>
      )}

      {extendModal && (
        <div className={styles.overlay} onClick={() => setExtendModal(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h2 className={styles.modalTitle}>Extend — {extendModal.name}</h2>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.hint}>
                Currently ends {fmt(extendModal.currentEnd)}. Extensions are appended to the record with
                your reason rather than overwriting the original dates.
              </p>
              <div className={styles.field}>
                <label className={styles.label}>New end date</label>
                <input className={styles.input} type="date" value={extendModal.newEndDate}
                  min={extendModal.currentEnd}
                  onChange={(e) => setExtendModal({ ...extendModal, newEndDate: e.target.value })} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Reason for the extension</label>
                <textarea className={styles.textarea} value={extendModal.reason}
                  onChange={(e) => setExtendModal({ ...extendModal, reason: e.target.value })}
                  placeholder="Contractor delayed by material shortage" />
              </div>
            </div>
            <div className={styles.modalFoot}>
              <button className={styles.btn} onClick={() => setExtendModal(null)}>Cancel</button>
              <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}
                onClick={() => call(`/api/amenities/maintenance/${extendModal.id}/extend`,
                  { newEndDate: extendModal.newEndDate, reason: extendModal.reason }, "POST",
                  "Maintenance extended — residents notified", () => setExtendModal(null))}>
                {saving ? "Saving…" : "Extend"}
              </button>
            </div>
          </div>
        </div>
      )}

      {reopenModal && (
        <div className={styles.overlay} onClick={() => setReopenModal(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h2 className={styles.modalTitle}>Reopen — {reopenModal.name}</h2>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.hint}>
                The amenity returns to whatever status it had before maintenance began, and residents are
                told it is available again. Actual end date is recorded separately from the scheduled one,
                so planned versus actual downtime stays answerable.
              </p>
              <div className={styles.field}>
                <label className={styles.label}>Completion notes</label>
                <textarea className={styles.textarea} value={reopenModal.notes}
                  onChange={(e) => setReopenModal({ ...reopenModal, notes: e.target.value })} />
              </div>
            </div>
            <div className={styles.modalFoot}>
              <button className={styles.btn} onClick={() => setReopenModal(null)}>Cancel</button>
              <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}
                onClick={() => call(`/api/amenities/maintenance/${reopenModal.id}/reopen`,
                  { notes: reopenModal.notes }, "POST",
                  "Amenity reopened — residents notified", () => setReopenModal(null))}>
                {saving ? "Saving…" : "Reopen now"}
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

"use client";
import { useState, useEffect, useCallback } from "react";
import styles from "@/styles/Amenities.module.css";

const iso = (d) => d.toISOString().slice(0, 10);
const time = (d) => (d ? new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "—");
const day = (d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const dur = (m) => (m == null ? "—" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`);

export default function AttendancePage() {
  const [rows, setRows] = useState([]);
  const [amenities, setAmenities] = useState([]);
  const [amenityId, setAmenityId] = useState("all");
  const [openOnly, setOpenOnly] = useState(true);
  const [range, setRange] = useState(() => ({ from: iso(new Date()), to: iso(new Date()) }));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [checkInModal, setCheckInModal] = useState(null);
  const [adjustModal, setAdjustModal] = useState(null);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 5000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (openOnly) params.set("openOnly", "true");
      else { params.set("from", range.from); params.set("to", range.to); }
      if (amenityId !== "all") params.set("amenityId", amenityId);
      const res = await fetch(`/api/amenities/attendance?${params}`, { credentials: "include" });
      const data = await res.json();
      if (res.ok) setRows(data.attendance || []);
      else showToast(data.error || "Could not load attendance", "err");
    } finally {
      setLoading(false);
    }
  }, [amenityId, openOnly, range]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch("/api/amenities?limit=100", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setAmenities(d.amenities || []))
      .catch(() => {});
  }, []);

  const checkOut = async (row) => {
    setSaving(true);
    try {
      const res = await fetch("/api/amenities/attendance/checkout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendanceId: row._id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not check out");
      showToast("Checked out");
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSaving(false);
    }
  };

  const autoCheckout = async () => {
    if (!confirm("Close all stale sessions past the society cutoff?")) return;
    setSaving(true);
    try {
      const res = await fetch("/api/amenities/attendance/auto-checkout", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      showToast(`${data.closed} stale ${data.closed === 1 ? "session" : "sessions"} closed`);
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
          <h1 className={styles.title}>Attendance</h1>
          <p className={styles.subtitle}>
            {openOnly ? "Everyone currently checked in" : `${range.from} to ${range.to}`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={styles.btn} onClick={autoCheckout} disabled={saving}>Close stale sessions</button>
          <button className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={!amenities.length}
            onClick={() => setCheckInModal({
              amenityId: amenities[0]?._id || "", attendeeType: "RESIDENT",
              residentName: "", flatNo: "", visitorName: "", visitorPhone: "",
              overrideReason: "", notes: "",
            })}>
            + Record check-in
          </button>
        </div>
      </div>

      <div className={styles.toolbar}>
        <select className={styles.select} value={amenityId} onChange={(e) => setAmenityId(e.target.value)}>
          <option value="all">All amenities</option>
          {amenities.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
        </select>
        <label className={styles.checkRow}>
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
          Currently inside only
        </label>
        {!openOnly && (
          <>
            <input className={styles.input} type="date" value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })} />
            <span className={styles.hint}>to</span>
            <input className={styles.input} type="date" value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </>
        )}
      </div>

      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : !rows.length ? (
        <div className={styles.tableWrap}>
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>{openOnly ? "Nobody is checked in" : "No attendance in this range"}</p>
            <p className={styles.emptyText}>
              {openOnly ? "Uncheck the filter to see history." : "Try a wider date range."}
            </p>
          </div>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Person</th><th style={{ width: 150 }}>Amenity</th>
                <th style={{ width: 130 }}>In</th><th style={{ width: 130 }}>Out</th>
                <th style={{ width: 90 }}>Duration</th><th style={{ width: 110 }}>Method</th>
                <th style={{ width: 160 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id}>
                  <td>
                    <div className={styles.rowName}>
                      {r.attendeeType === "VISITOR" ? r.visitorName : r.residentName || "—"}
                    </div>
                    <div className={styles.rowSub}>
                      {r.attendeeType === "VISITOR"
                        ? `Visitor${r.visitorPhone ? ` · ${r.visitorPhone}` : ""}`
                        : `${r.flatNo || "—"}${r.occupancyType ? ` · ${r.occupancyType}` : ""}`}
                      {r.guestCount ? ` · +${r.guestCount} guests` : ""}
                    </div>
                  </td>
                  <td>
                    {r.amenityName}
                    {r.slotLabel ? <div className={styles.rowSub}>{r.slotLabel}</div> : null}
                  </td>
                  <td>
                    {time(r.timeIn)}
                    <div className={styles.rowSub}>{day(r.timeIn)}</div>
                  </td>
                  <td>
                    {r.timeOut ? time(r.timeOut) : <span className={`${styles.pill} ${styles.pillOpen}`}>Inside</span>}
                    {r.autoCheckedOut ? <div className={styles.rowSub}>auto-closed</div> : null}
                  </td>
                  <td>{dur(r.durationMins)}</td>
                  <td>
                    <span className={`${styles.pill} ${styles.pillMuted}`}>{r.checkInMethod}</span>
                    {r.isOverride ? <div className={styles.rowSub}>override</div> : null}
                    {r.adjustedAt ? <div className={styles.rowSub}>corrected</div> : null}
                  </td>
                  <td>
                    <div className={styles.actions}>
                      {!r.timeOut && (
                        <button className={`${styles.btn} ${styles.btnSm}`} onClick={() => checkOut(r)} disabled={saving}>
                          Check out
                        </button>
                      )}
                      <button className={`${styles.btn} ${styles.btnSm}`}
                        onClick={() => setAdjustModal({ id: r._id, reason: "", notes: r.notes || "" })}>
                        Correct
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {checkInModal && (
        <div className={styles.overlay} onClick={() => setCheckInModal(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}><h2 className={styles.modalTitle}>Record a check-in</h2></div>
            <div className={styles.modalBody}>
              <div className={styles.field}>
                <label className={styles.label}>Amenity</label>
                <select className={styles.select} value={checkInModal.amenityId}
                  onChange={(e) => setCheckInModal({ ...checkInModal, amenityId: e.target.value })}>
                  {amenities.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Who</label>
                <select className={styles.select} value={checkInModal.attendeeType}
                  onChange={(e) => setCheckInModal({ ...checkInModal, attendeeType: e.target.value })}>
                  <option value="RESIDENT">Resident</option>
                  <option value="VISITOR">Visitor</option>
                  <option value="STAFF">Staff</option>
                </select>
              </div>
              {checkInModal.attendeeType === "VISITOR" ? (
                <div className={styles.grid2}>
                  <div className={styles.field}>
                    <label className={styles.label}>Visitor name</label>
                    <input className={styles.input} value={checkInModal.visitorName}
                      onChange={(e) => setCheckInModal({ ...checkInModal, visitorName: e.target.value })} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Phone</label>
                    <input className={styles.input} value={checkInModal.visitorPhone}
                      onChange={(e) => setCheckInModal({ ...checkInModal, visitorPhone: e.target.value })} />
                  </div>
                </div>
              ) : (
                <div className={styles.grid2}>
                  <div className={styles.field}>
                    <label className={styles.label}>Name</label>
                    <input className={styles.input} value={checkInModal.residentName}
                      onChange={(e) => setCheckInModal({ ...checkInModal, residentName: e.target.value })} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Flat</label>
                    <input className={styles.input} value={checkInModal.flatNo}
                      onChange={(e) => setCheckInModal({ ...checkInModal, flatNo: e.target.value })} />
                  </div>
                </div>
              )}
              <div className={styles.field}>
                <label className={styles.label}>Override reason</label>
                <input className={styles.input} value={checkInModal.overrideReason}
                  onChange={(e) => setCheckInModal({ ...checkInModal, overrideReason: e.target.value })}
                  placeholder="Only if admitting against the rules" />
                <span className={styles.hint}>
                  Staff-recorded check-ins skip eligibility checks. If you are admitting someone the rules
                  would refuse, say why — it is recorded on the row.
                </span>
              </div>
            </div>
            <div className={styles.modalFoot}>
              <button className={styles.btn} onClick={() => setCheckInModal(null)}>Cancel</button>
              <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    const res = await fetch("/api/amenities/attendance", {
                      method: "POST", credentials: "include",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(checkInModal),
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || "Could not check in");
                    showToast("Checked in");
                    setCheckInModal(null);
                    load();
                  } catch (err) {
                    showToast(err.message, "err");
                  } finally {
                    setSaving(false);
                  }
                }}>
                {saving ? "Saving…" : "Check in"}
              </button>
            </div>
          </div>
        </div>
      )}

      {adjustModal && (
        <div className={styles.overlay} onClick={() => setAdjustModal(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}><h2 className={styles.modalTitle}>Correct this record</h2></div>
            <div className={styles.modalBody}>
              <div className={`${styles.banner} ${styles.bannerWarn}`} style={{ marginBottom: 0 }}>
                Attendance rows are never deleted. This records a correction against the original, stamped
                with your name and reason — which is what makes the ledger worth trusting.
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Reason for the correction</label>
                <textarea className={styles.textarea} value={adjustModal.reason}
                  onChange={(e) => setAdjustModal({ ...adjustModal, reason: e.target.value })}
                  placeholder="Guard forgot to check the resident out at closing" />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Check-out time</label>
                <input className={styles.input} type="datetime-local"
                  value={adjustModal.timeOut || ""}
                  onChange={(e) => setAdjustModal({ ...adjustModal, timeOut: e.target.value })} />
              </div>
            </div>
            <div className={styles.modalFoot}>
              <button className={styles.btn} onClick={() => setAdjustModal(null)}>Cancel</button>
              <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}
                onClick={async () => {
                  if (!adjustModal.reason || adjustModal.reason.trim().length < 3) {
                    return showToast("A reason is required for any correction", "err");
                  }
                  setSaving(true);
                  try {
                    const res = await fetch(`/api/amenities/attendance/${adjustModal.id}`, {
                      method: "PATCH", credentials: "include",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        reason: adjustModal.reason,
                        timeOut: adjustModal.timeOut ? new Date(adjustModal.timeOut).toISOString() : undefined,
                        notes: adjustModal.notes || undefined,
                      }),
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || "Could not save the correction");
                    showToast("Correction recorded");
                    setAdjustModal(null);
                    load();
                  } catch (err) {
                    showToast(err.message, "err");
                  } finally {
                    setSaving(false);
                  }
                }}>
                {saving ? "Saving…" : "Record correction"}
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

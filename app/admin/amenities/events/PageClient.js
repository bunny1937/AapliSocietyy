"use client";
import { useState, useEffect, useCallback } from "react";
import styles from "@/styles/Amenities.module.css";

const iso = (d) => d.toISOString().slice(0, 10);
const label = (s) => (s || "").replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
const PILL = { DRAFT: "pillMuted", PUBLISHED: "pillOpen", CANCELLED: "pillPerm", COMPLETED: "pillInfo" };
const when = (d) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default function EventsPage() {
  const [events, setEvents] = useState([]);
  const [amenities, setAmenities] = useState([]);
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [createModal, setCreateModal] = useState(null);
  const [detail, setDetail] = useState(null);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 5000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const from = new Date(Date.now() - 30 * 86400000);
      const to = new Date(Date.now() + 120 * 86400000);
      const params = new URLSearchParams({ from: iso(from), to: iso(to), limit: "100" });
      if (status !== "all") params.set("status", status);
      const res = await fetch(`/api/amenities/events?${params}`, { credentials: "include" });
      const data = await res.json();
      if (res.ok) setEvents(data.events || []);
      else showToast(data.error || "Could not load events", "err");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch("/api/amenities?limit=100", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setAmenities(d.amenities || []))
      .catch(() => {});
  }, []);

  const openDetail = async (ev) => {
    // Registrations and the waitlist are a separate read — the list view does not
    // need them, and most events are never opened.
    try {
      const [rRes, wRes] = await Promise.all([
        fetch(`/api/amenities/events/${ev._id}/registrations`, { credentials: "include" }),
        fetch(`/api/amenities/events/${ev._id}/waitlist`, { credentials: "include" }),
      ]);
      const [r, wl] = await Promise.all([rRes.json(), wRes.json()]);
      setDetail({ event: ev, registrations: r.registrations || [], waitlist: wl.waitlist || [] });
    } catch {
      showToast("Could not load registrations", "err");
    }
  };

  const create = async () => {
    if (!createModal.title?.trim() || !createModal.startAt || !createModal.endAt) {
      return showToast("Title, start and end are all required", "err");
    }
    setSaving(true);
    try {
      const res = await fetch("/api/amenities/events", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amenityId: createModal.amenityId,
          title: createModal.title.trim(),
          description: createModal.description?.trim() || undefined,
          organizerName: createModal.organizerName?.trim() || undefined,
          startAt: new Date(createModal.startAt).toISOString(),
          endAt: new Date(createModal.endAt).toISOString(),
          capacity: createModal.capacity ? Number(createModal.capacity) : null,
          registrationRequired: createModal.registrationRequired,
          guestsAllowed: createModal.guestsAllowed,
          waitlistEnabled: createModal.waitlistEnabled,
          status: createModal.publish ? "PUBLISHED" : "DRAFT",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create the event");
      showToast(createModal.publish ? "Event published — residents notified" : "Draft saved");
      setCreateModal(null);
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
          <h1 className={styles.title}>Events</h1>
          <p className={styles.subtitle}>Events hosted at your amenities</p>
        </div>
        <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={!amenities.length}
          onClick={() => setCreateModal({
            amenityId: amenities[0]?._id || "", title: "", description: "", organizerName: "",
            startAt: "", endAt: "", capacity: "", registrationRequired: true,
            guestsAllowed: false, waitlistEnabled: true, publish: true,
          })}>
          + New event
        </button>
      </div>

      <div className={styles.tabs}>
        {["all", "PUBLISHED", "DRAFT", "COMPLETED", "CANCELLED"].map((s) => (
          <button key={s} className={`${styles.tab} ${status === s ? styles.tabActive : ""}`} onClick={() => setStatus(s)}>
            {s === "all" ? "All" : label(s)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : !events.length ? (
        <div className={styles.tableWrap}>
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No events</p>
            <p className={styles.emptyText}>Yoga, society meetings, festival celebrations — create one to start.</p>
          </div>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Event</th><th style={{ width: 170 }}>When</th>
                <th style={{ width: 130 }}>Registered</th><th style={{ width: 100 }}>Waitlist</th>
                <th style={{ width: 120 }}>Status</th><th style={{ width: 170 }}></th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const full = e.capacity && (e.registeredCount || 0) >= e.capacity;
                return (
                  <tr key={e._id}>
                    <td>
                      <div className={styles.rowName}>{e.title}</div>
                      <div className={styles.rowSub}>
                        {e.amenityName}{e.organizerName ? ` · ${e.organizerName}` : ""}
                      </div>
                    </td>
                    <td>{when(e.startAt)}</td>
                    <td>
                      {e.registeredCount || 0}{e.capacity ? ` / ${e.capacity}` : ""}
                      {full ? <div className={styles.rowSub}>full</div> : null}
                      {e.guestCount ? <div className={styles.rowSub}>+{e.guestCount} guests</div> : null}
                    </td>
                    <td>{e.waitlistCount || 0}</td>
                    <td>
                      <span className={`${styles.pill} ${styles[PILL[e.status] || "pillMuted"]}`}>{label(e.status)}</span>
                    </td>
                    <td>
                      <div className={styles.actions}>
                        <button className={`${styles.btn} ${styles.btnSm}`} onClick={() => openDetail(e)}>
                          Attendees
                        </button>
                        {["DRAFT", "PUBLISHED"].includes(e.status) && (
                          <button className={`${styles.btn} ${styles.btnSm} ${styles.btnDanger}`}
                            onClick={async () => {
                              const reason = prompt("Why is this event being cancelled? Registrants will be told.");
                              if (reason === null) return;
                              const res = await fetch(`/api/amenities/events/${e._id}`, {
                                method: "DELETE", credentials: "include",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ reason }),
                              });
                              const data = await res.json();
                              if (!res.ok) return showToast(data.error || "Could not cancel", "err");
                              showToast("Event cancelled — registrants notified");
                              load();
                            }}>
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {createModal && (
        <div className={styles.overlay} onClick={() => setCreateModal(null)}>
          <div className={`${styles.modal} ${styles.modalWide}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}><h2 className={styles.modalTitle}>New event</h2></div>
            <div className={styles.modalBody}>
              <div className={styles.grid2}>
                <div className={styles.field}>
                  <label className={styles.label}>Amenity / venue</label>
                  <select className={styles.select} value={createModal.amenityId}
                    onChange={(e) => setCreateModal({ ...createModal, amenityId: e.target.value })}>
                    {amenities.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
                  </select>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Organizer</label>
                  <input className={styles.input} value={createModal.organizerName}
                    onChange={(e) => setCreateModal({ ...createModal, organizerName: e.target.value })} />
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Title</label>
                <input className={styles.input} autoFocus value={createModal.title}
                  onChange={(e) => setCreateModal({ ...createModal, title: e.target.value })}
                  placeholder="Morning yoga" />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Description</label>
                <textarea className={styles.textarea} value={createModal.description}
                  onChange={(e) => setCreateModal({ ...createModal, description: e.target.value })} />
              </div>
              <div className={styles.grid2}>
                <div className={styles.field}>
                  <label className={styles.label}>Starts</label>
                  <input className={styles.input} type="datetime-local" value={createModal.startAt}
                    onChange={(e) => setCreateModal({ ...createModal, startAt: e.target.value })} />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Ends</label>
                  <input className={styles.input} type="datetime-local" value={createModal.endAt}
                    onChange={(e) => setCreateModal({ ...createModal, endAt: e.target.value })} />
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Capacity</label>
                <input className={styles.input} type="number" min={1} value={createModal.capacity}
                  onChange={(e) => setCreateModal({ ...createModal, capacity: e.target.value })}
                  placeholder="Leave blank for unlimited" />
              </div>
              <label className={styles.checkRow}>
                <input type="checkbox" checked={createModal.registrationRequired}
                  onChange={(e) => setCreateModal({ ...createModal, registrationRequired: e.target.checked })} />
                Registration required
              </label>
              <label className={styles.checkRow}>
                <input type="checkbox" checked={createModal.guestsAllowed}
                  onChange={(e) => setCreateModal({ ...createModal, guestsAllowed: e.target.checked })} />
                Residents may bring guests
              </label>
              <label className={styles.checkRow}>
                <input type="checkbox" checked={createModal.waitlistEnabled}
                  onChange={(e) => setCreateModal({ ...createModal, waitlistEnabled: e.target.checked })} />
                Waitlist when full — promotes automatically on a cancellation
              </label>
              <label className={styles.checkRow}>
                <input type="checkbox" checked={createModal.publish}
                  onChange={(e) => setCreateModal({ ...createModal, publish: e.target.checked })} />
                Publish now and notify residents
              </label>
              <p className={styles.hint}>
                Save as a draft if the details are not settled. Drafts are invisible to residents.
              </p>
            </div>
            <div className={styles.modalFoot}>
              <button className={styles.btn} onClick={() => setCreateModal(null)}>Cancel</button>
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={create} disabled={saving}>
                {saving ? "Saving…" : createModal.publish ? "Publish" : "Save draft"}
              </button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div className={styles.overlay} onClick={() => setDetail(null)}>
          <div className={`${styles.modal} ${styles.modalWide}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h2 className={styles.modalTitle}>{detail.event.title}</h2>
              <p className={styles.subtitle} style={{ marginTop: 4 }}>{when(detail.event.startAt)}</p>
            </div>
            <div className={styles.modalBody}>
              <h3 className={styles.cardTitle} style={{ margin: 0 }}>
                Registered ({detail.registrations.length})
              </h3>
              {!detail.registrations.length ? (
                <p className={styles.emptyText}>Nobody registered yet.</p>
              ) : (
                <table className={styles.table}>
                  <tbody>
                    {detail.registrations.map((r) => (
                      <tr key={r._id}>
                        <td>
                          <div className={styles.rowName}>{r.memberName}</div>
                          <div className={styles.rowSub}>
                            {r.flatNo}{r.guestCount ? ` · +${r.guestCount} guests` : ""}
                            {r.fromWaitlist ? " · promoted from waitlist" : ""}
                          </div>
                        </td>
                        <td style={{ width: 130 }}>
                          <span className={`${styles.pill} ${r.status === "ATTENDED" ? styles.pillOpen : r.status === "NO_SHOW" ? styles.pillPerm : styles.pillMuted}`}>
                            {label(r.status)}
                          </span>
                        </td>
                        <td style={{ width: 170 }}>
                          {r.status === "CONFIRMED" && (
                            <div className={styles.actions}>
                              {["ATTENDED", "NO_SHOW"].map((st) => (
                                <button key={st} className={`${styles.btn} ${styles.btnSm}`}
                                  onClick={async () => {
                                    const res = await fetch(`/api/amenities/events/${detail.event._id}/registrations`, {
                                      method: "PATCH", credentials: "include",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ registrationId: r._id, status: st }),
                                    });
                                    if (!res.ok) return showToast("Could not update", "err");
                                    showToast("Updated");
                                    openDetail(detail.event);
                                    load();
                                  }}>
                                  {st === "ATTENDED" ? "Attended" : "No show"}
                                </button>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <h3 className={styles.cardTitle} style={{ margin: "10px 0 0" }}>
                Waitlist ({detail.waitlist.length})
              </h3>
              {!detail.waitlist.length ? (
                <p className={styles.emptyText}>Nobody queued.</p>
              ) : (
                <table className={styles.table}>
                  <tbody>
                    {detail.waitlist.map((w) => (
                      <tr key={w._id}>
                        <td style={{ width: 44 }}>
                          <span className={`${styles.pill} ${styles.pillMuted}`}>#{w.position}</span>
                        </td>
                        <td>
                          <div className={styles.rowName}>{w.memberName}</div>
                          <div className={styles.rowSub}>{w.flatNo}</div>
                        </td>
                        <td style={{ width: 120 }}>
                          <span className={`${styles.pill} ${styles.pillMuted}`}>{label(w.status)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className={styles.modalFoot}>
              <button className={styles.btn} onClick={() => setDetail(null)}>Close</button>
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

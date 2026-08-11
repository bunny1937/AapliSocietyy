"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import styles from "@/styles/Amenities.module.css";

const STATUSES = ["OPEN", "CLOSED", "UNDER_MAINTENANCE", "TEMPORARILY_CLOSED", "PERMANENTLY_CLOSED"];
const MODES = ["NONE", "MANUAL", "QR", "QR_MANUAL"];
const PILL = {
  OPEN: "pillOpen", CLOSED: "pillClosed", UNDER_MAINTENANCE: "pillMaint",
  TEMPORARILY_CLOSED: "pillTemp", PERMANENTLY_CLOSED: "pillPerm",
};
const label = (s) => (s || "").replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

export default function AmenityListPage() {
  const [amenities, setAmenities] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({});
  const [toast, setToast] = useState(null);
  const [createModal, setCreateModal] = useState(null);
  const [statusModal, setStatusModal] = useState(null);
  const [saving, setSaving] = useState(false);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20", includeInactive: "true" });
      if (search.trim()) params.set("search", search.trim());
      if (categoryId !== "all") params.set("categoryId", categoryId);
      if (status !== "all") params.set("status", status);
      const res = await fetch(`/api/amenities?${params}`, { credentials: "include" });
      const data = await res.json();
      if (res.ok) {
        setAmenities(data.amenities || []);
        setMeta(data.pagination || {});
      } else showToast(data.error || "Could not load amenities", "err");
    } finally {
      setLoading(false);
    }
  }, [page, search, categoryId, status]);

  useEffect(() => {
    // Debounced so typing in the search box does not fire a request per keystroke.
    const t = setTimeout(load, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  useEffect(() => {
    fetch("/api/amenities/categories", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setCategories(d.categories || []))
      .catch(() => {});
  }, []);

  const create = async () => {
    if (!createModal?.name?.trim() || !createModal.categoryId) {
      return showToast("A name and a category are both required", "err");
    }
    setSaving(true);
    try {
      const res = await fetch("/api/amenities", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createModal.name.trim(),
          categoryId: createModal.categoryId,
          description: createModal.description?.trim() || undefined,
          location: createModal.location?.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create the amenity");
      showToast("Amenity created — open it to set hours, access and rules");
      setCreateModal(null);
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async () => {
    if (!statusModal) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/amenities/${statusModal.id}/status`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: statusModal.status,
          note: statusModal.note?.trim() || undefined,
          isEmergency: !!statusModal.isEmergency,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not change the status");
      showToast(
        data.notified
          ? "Status changed — residents have been notified"
          : "Status changed",
      );
      setStatusModal(null);
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
          <h1 className={styles.title}>All amenities</h1>
          <p className={styles.subtitle}>{meta.total ?? amenities.length} total</p>
        </div>
        <button
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={() => setCreateModal({ name: "", categoryId: categories[0]?._id || "", description: "", location: "" })}
          disabled={!categories.length}
          title={!categories.length ? "Create a category first" : undefined}
        >
          + New amenity
        </button>
      </div>

      {!categories.length && !loading && (
        <div className={`${styles.banner} ${styles.bannerWarn}`}>
          Every amenity belongs to a category, so create at least one category before adding amenities.
        </div>
      )}

      <div className={styles.toolbar}>
        <input
          className={`${styles.input} ${styles.search}`}
          placeholder="Search amenities…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <select className={styles.select} value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }}>
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
        </select>
        <select className={styles.select} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="all">Any status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : !amenities.length ? (
        <div className={styles.tableWrap}>
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>Nothing matches</p>
            <p className={styles.emptyText}>Try clearing the filters, or create a new amenity.</p>
          </div>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Amenity</th>
                <th style={{ width: 140 }}>Category</th>
                <th style={{ width: 150 }}>Status</th>
                <th style={{ width: 160 }}>Occupancy</th>
                <th style={{ width: 110 }}>Attendance</th>
                <th style={{ width: 150 }}></th>
              </tr>
            </thead>
            <tbody>
              {amenities.map((a) => {
                const cap = a.capacitySnapshot;
                const pct = cap && !cap.unlimited ? cap.usagePct || 0 : null;
                return (
                  <tr key={a._id}>
                    <td>
                      <div className={styles.rowName}>{a.name}</div>
                      <div className={styles.rowSub}>
                        {a.location || "No location set"}
                        {!a.isActive ? " · inactive" : ""}
                      </div>
                    </td>
                    <td>{a.categoryName}</td>
                    <td>
                      <span className={`${styles.pill} ${styles[PILL[a.status] || "pillMuted"]}`}>
                        {label(a.status)}
                      </span>
                      {a.effectiveStatus && a.effectiveStatus.state !== "OPEN" && a.status === "OPEN" ? (
                        <div className={styles.rowSub}>{a.effectiveStatus.label}</div>
                      ) : null}
                    </td>
                    <td>
                      {pct === null ? (
                        <span className={styles.capText}>Unlimited</span>
                      ) : (
                        <div>
                          <div className={styles.capBar}>
                            <div
                              className={`${styles.capFill} ${pct >= 100 ? styles.capFull : cap.level === "WARNING" ? styles.capWarn : styles.capOk}`}
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                          <div className={styles.capText}>{cap.current} / {cap.maxOccupancy}</div>
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`${styles.pill} ${styles.pillMuted}`}>
                        {a.attendanceMode === "QR_MANUAL" ? "QR + manual" : label(a.attendanceMode)}
                      </span>
                    </td>
                    <td>
                      <div className={styles.actions}>
                        <button
                          className={`${styles.btn} ${styles.btnSm}`}
                          onClick={() => setStatusModal({ id: a._id, name: a.name, status: a.status, note: "", isEmergency: false })}
                        >
                          Status
                        </button>
                        <Link href={`/admin/amenities/${a._id}`} className={`${styles.btn} ${styles.btnSm}`}>
                          Manage
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {meta.totalPages > 1 && (
            <div className={styles.pager}>
              <span>Page {meta.page} of {meta.totalPages}</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className={`${styles.btn} ${styles.btnSm}`} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <button className={`${styles.btn} ${styles.btnSm}`} disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            </div>
          )}
        </div>
      )}

      {createModal && (
        <div className={styles.overlay} onClick={() => setCreateModal(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}><h2 className={styles.modalTitle}>New amenity</h2></div>
            <div className={styles.modalBody}>
              <div className={styles.field}>
                <label className={styles.label}>Name</label>
                <input className={styles.input} autoFocus value={createModal.name}
                  onChange={(e) => setCreateModal({ ...createModal, name: e.target.value })}
                  placeholder="Swimming Pool" />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Category</label>
                <select className={styles.select} value={createModal.categoryId}
                  onChange={(e) => setCreateModal({ ...createModal, categoryId: e.target.value })}>
                  {categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Location</label>
                <input className={styles.input} value={createModal.location}
                  onChange={(e) => setCreateModal({ ...createModal, location: e.target.value })}
                  placeholder="Optional — e.g. Basement, Tower B" />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Description</label>
                <textarea className={styles.textarea} value={createModal.description}
                  onChange={(e) => setCreateModal({ ...createModal, description: e.target.value })} />
              </div>
              <p className={styles.hint}>
                Hours, access, capacity, slots and rules are set on the amenity page after it is created.
              </p>
            </div>
            <div className={styles.modalFoot}>
              <button className={styles.btn} onClick={() => setCreateModal(null)}>Cancel</button>
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={create} disabled={saving}>
                {saving ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {statusModal && (
        <div className={styles.overlay} onClick={() => setStatusModal(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h2 className={styles.modalTitle}>Change status — {statusModal.name}</h2>
            </div>
            <div className={styles.modalBody}>
              <div className={`${styles.banner} ${styles.bannerWarn}`} style={{ marginBottom: 0 }}>
                Changing status notifies every resident. That is why it is a deliberate action here rather
                than an inline toggle.
              </div>
              <div className={styles.field}>
                <label className={styles.label}>New status</label>
                <select className={styles.select} value={statusModal.status}
                  onChange={(e) => setStatusModal({ ...statusModal, status: e.target.value })}>
                  {STATUSES.filter((s) => s !== "UNDER_MAINTENANCE").map((s) => (
                    <option key={s} value={s}>{label(s)}</option>
                  ))}
                </select>
                <span className={styles.hint}>
                  Under maintenance is set by scheduling maintenance, not chosen here.
                </span>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Note for residents</label>
                <textarea className={styles.textarea} value={statusModal.note}
                  onChange={(e) => setStatusModal({ ...statusModal, note: e.target.value })}
                  placeholder="Why, and when it is expected to reopen" />
              </div>
              <label className={styles.checkRow}>
                <input type="checkbox" checked={statusModal.isEmergency}
                  onChange={(e) => setStatusModal({ ...statusModal, isEmergency: e.target.checked })} />
                Emergency — send at high priority, overriding notification preferences
              </label>
            </div>
            <div className={styles.modalFoot}>
              <button className={styles.btn} onClick={() => setStatusModal(null)}>Cancel</button>
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={changeStatus} disabled={saving}>
                {saving ? "Saving…" : "Change status"}
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

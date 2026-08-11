"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import QRCode from "qrcode";
import styles from "@/styles/Amenities.module.css";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TABS = [
  "Basics", "Availability", "Access", "Capacity", "Slots",
  "Rules", "Visitors", "Attendance & QR", "Maintenance",
];
const AUDIENCES = ["EVERYONE", "OWNERS", "TENANTS", "STAFF", "COMMITTEE", "CUSTOM"];
const MODES = ["NONE", "MANUAL", "QR", "QR_MANUAL"];
const RULE_KINDS = [
  ["RULE", "Rules"], ["DO", "Do"], ["DONT", "Don't"], ["INSTRUCTION", "Instructions"],
];
const label = (s) => (s || "").replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

export default function AmenityDetailPage() {
  const { id } = useParams();
  const router = useRouter();

  const [amenity, setAmenity] = useState(null);
  const [categories, setCategories] = useState([]);
  const [settings, setSettings] = useState(null);
  const [slots, setSlots] = useState([]);
  const [rules, setRules] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [closures, setClosures] = useState([]);
  const [maintenance, setMaintenance] = useState([]);
  const [qr, setQr] = useState(null);
  const [newToken, setNewToken] = useState(null);
  const [qrImage, setQrImage] = useState(null);
  const [editingSlot, setEditingSlot] = useState(null);
  const [savingSlot, setSavingSlot] = useState(false);
  const [selectingSlots, setSelectingSlots] = useState(false);
  const [selectedSlotIds, setSelectedSlotIds] = useState([]);
  const [ruleDraft, setRuleDraft] = useState([]);
  const [savingRules, setSavingRules] = useState(false);
  const [weeklyDraft, setWeeklyDraft] = useState(() => DAYS.map((_, i) => ({ dayOfWeek: i, windows: [] })));
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [quickOpen, setQuickOpen] = useState("09:00");
  const [quickClose, setQuickClose] = useState("21:00");
  const [quickBreaks, setQuickBreaks] = useState([]);
  const [closureDraft, setClosureDraft] = useState({ closureType: "HOLIDAY", startDate: "", endDate: "", reason: "" });
  const [savingClosure, setSavingClosure] = useState(false);
  const newRuleKey = () => `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const newKey = () => `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const [tab, setTab] = useState("Basics");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [draft, setDraft] = useState({});

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 5000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [aRes, cRes, sRes] = await Promise.all([
        fetch(`/api/amenities/${id}`, { credentials: "include" }),
        fetch("/api/amenities/categories", { credentials: "include" }),
        fetch("/api/amenities/settings", { credentials: "include" }),
      ]);
      const [a, c, s] = await Promise.all([aRes.json(), cRes.json(), sRes.json()]);
      if (!aRes.ok) throw new Error(a.error || "Could not load this amenity");

      // The detail endpoint returns the whole configuration in one response, so
      // switching tabs never costs another round trip.
      setAmenity(a.amenity);
      setSlots(a.slots || []);
      // API may return `rules` either grouped by kind (object) or as a flat array.
      // Normalize to an array so `rules.filter(...)` works in the UI.
      const loadedRules = a.rules || [];
      const flatRules = Array.isArray(loadedRules) ? loadedRules : [].concat(...Object.values(loadedRules || {}));
      setRules(flatRules);
      setRuleDraft(flatRules
        .filter((r) => r.isActive !== false)
        .map((r) => ({ key: r._id || newRuleKey(), kind: r.kind, text: r.text, displayOrder: r.displayOrder ?? 0 })));
      setAvailability(a.availability || []);
      const weeklyRows = (a.availability || []).filter((r) => r.type === "WEEKLY");
      setWeeklyDraft(DAYS.map((_, i) => ({
        dayOfWeek: i,
        windows: weeklyRows
          .filter((r) => r.dayOfWeek === i)
          .map((r) => ({ key: r._id || newKey(), openTime: r.openTime, closeTime: r.closeTime })),
      })));
      setClosures(a.closures || []);
      setMaintenance(a.maintenance || []);
      setQr(a.qr || null);
      setCategories(c.categories || []);
      setSettings(s.settings || null);
      setDraft({
        name: a.amenity.name,
        categoryId: a.amenity.categoryId,
        description: a.amenity.description || "",
        location: a.amenity.location || "",
        contactName: a.amenity.contactPerson?.name || "",
        contactPhone: a.amenity.contactPerson?.phone || "",
        isActive: a.amenity.isActive,
        access: { ...(a.amenity.access || {}) },
        capacity: { ...(a.amenity.capacity || {}) },
        slotPolicy: { ...(a.amenity.slotPolicy || {}) },
        visitorPolicy: { ...(a.amenity.visitorPolicy || {}) },
        attendanceMode: a.amenity.attendanceMode,
      });
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!newToken) { setQrImage(null); return; }
    const value = newToken.deepLink || newToken.token;
    if (!value) return;
    let cancelled = false;
    QRCode.toDataURL(value, { width: 220, margin: 1 })
      .then((url) => { if (!cancelled) setQrImage(url); })
      .catch((err) => console.error("QR render failed", err));
    return () => { cancelled = true; };
  }, [newToken]);

  const addWindow = (dayOfWeek) => {
    setWeeklyDraft((prev) => prev.map((d) => (
      d.dayOfWeek === dayOfWeek
        ? { ...d, windows: [...d.windows, { key: newKey(), openTime: "09:00", closeTime: "18:00" }] }
        : d
    )));
  };
  const removeWindow = (dayOfWeek, key) => {
    setWeeklyDraft((prev) => prev.map((d) => (
      d.dayOfWeek === dayOfWeek ? { ...d, windows: d.windows.filter((w) => w.key !== key) } : d
    )));
  };
  const updateWindow = (dayOfWeek, key, field, value) => {
    setWeeklyDraft((prev) => prev.map((d) => (
      d.dayOfWeek === dayOfWeek
        ? { ...d, windows: d.windows.map((w) => (w.key === key ? { ...w, [field]: value } : w)) }
        : d
    )));
  };

  // Cuts break windows out of an open-close span so residents can't book across
  // lunch/cleaning gaps without needing one manual window per gap per day.
  const splitByBreaks = (openTime, closeTime, breaks) => {
    const sorted = breaks
      .filter((b) => b.start && b.end && b.start < b.end && b.start > openTime && b.end < closeTime)
      .sort((a, b) => a.start.localeCompare(b.start));
    const windows = [];
    let cursor = openTime;
    for (const b of sorted) {
      if (b.start > cursor) windows.push({ openTime: cursor, closeTime: b.start });
      cursor = b.end > cursor ? b.end : cursor;
    }
    if (cursor < closeTime) windows.push({ openTime: cursor, closeTime });
    return windows.map((w) => ({ key: newKey(), ...w }));
  };

  const addBreak = () => setQuickBreaks((prev) => (prev.length >= 2 ? prev : [...prev, { key: newKey(), start: "13:00", end: "14:00" }]));
  const removeBreak = (key) => setQuickBreaks((prev) => prev.filter((b) => b.key !== key));
  const updateBreak = (key, field, value) => setQuickBreaks((prev) => prev.map((b) => (b.key === key ? { ...b, [field]: value } : b)));

  const applyAllDays = () => {
    const windows = splitByBreaks(quickOpen, quickClose, quickBreaks);
    setWeeklyDraft(DAYS.map((_, i) => ({ dayOfWeek: i, windows: windows.map((w) => ({ ...w, key: newKey() })) })));
  };
  const toggleDayOpen = (dayOfWeek, open) => {
    setWeeklyDraft((prev) => prev.map((d) => (
      d.dayOfWeek === dayOfWeek
        ? { ...d, windows: open ? splitByBreaks(quickOpen, quickClose, quickBreaks) : [] }
        : d
    )));
  };

  const saveAvailability = async () => {
    const weekly = weeklyDraft.flatMap((d) => d.windows.map((w) => ({
      dayOfWeek: d.dayOfWeek, openTime: w.openTime, closeTime: w.closeTime,
    })));
    setSavingAvailability(true);
    try {
      const res = await fetch(`/api/amenities/${id}/availability`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekly }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save weekly hours");
      showToast("Weekly hours saved");
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSavingAvailability(false);
    }
  };

  const addClosure = async () => {
    if (!closureDraft.startDate || !closureDraft.endDate || !closureDraft.reason.trim()) {
      return showToast("Start date, end date and reason are required", "err");
    }
    setSavingClosure(true);
    try {
      const res = await fetch(`/api/amenities/${id}/closures`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(closureDraft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not add closure");
      showToast("Closure added");
      setClosureDraft({ closureType: "HOLIDAY", startDate: "", endDate: "", reason: "" });
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSavingClosure(false);
    }
  };

  const removeClosure = async (closureId) => {
    if (!confirm("Cancel this closure? The amenity will reopen per its weekly hours.")) return;
    const res = await fetch(`/api/amenities/${id}/closures/${closureId}`, {
      method: "DELETE", credentials: "include",
    });
    if (!res.ok) return showToast("Could not cancel closure", "err");
    showToast("Closure cancelled");
    load();
  };

  const patchAmenity = async (body, successMsg) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/amenities/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      showToast(successMsg || "Saved");
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSaving(false);
    }
  };

  // A slot's identity on the server is { dayOfWeek, startTime } — PUT upserts
  // on that key. Changing the start time therefore targets a different key,
  // so the old slot is deactivated first or it would linger as a stray
  // duplicate alongside the edited one.
  const saveSlot = async (original, form) => {
    setSavingSlot(true);
    try {
      if (original && !original.isNew && original.startTime !== form.startTime) {
        const res = await fetch(`/api/amenities/${id}/slots`, {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dayOfWeek: original.dayOfWeek,
            startTime: original.startTime,
            endTime: original.endTime,
            isActive: false,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Could not move the old slot");
        }
      }

      const res = await fetch(`/api/amenities/${id}/slots`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayOfWeek: form.dayOfWeek,
          startTime: form.startTime,
          endTime: form.endTime,
          capacity: form.capacity === "" ? null : Number(form.capacity),
          label: form.label || "",
          isActive: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save the slot");
      showToast(original && !original.isNew ? "Slot updated" : "Slot added");
      setEditingSlot(null);
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSavingSlot(false);
    }
  };

  const deleteSlots = async (ids) => {
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} slot${ids.length === 1 ? "" : "s"}? This can't be undone.`)) return;
    setSavingSlot(true);
    try {
      const res = await fetch(`/api/amenities/${id}/slots`, {
        method: "DELETE", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not delete slots");
      showToast(`Deleted ${data.deleted} slot${data.deleted === 1 ? "" : "s"}`);
      setSelectingSlots(false);
      setSelectedSlotIds([]);
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSavingSlot(false);
    }
  };

  const removeSlot = async (s) => {
    if (!confirm(`Remove the ${s.startTime}–${s.endTime} slot?`)) return;
    setSavingSlot(true);
    try {
      const res = await fetch(`/api/amenities/${id}/slots`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime, isActive: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not remove the slot");
      showToast("Slot removed");
      setEditingSlot(null);
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSavingSlot(false);
    }
  };

  // Whole-list replace, matching the API: PUT /rules always sends the
  // complete set, never a single row.
  const saveRules = async () => {
    const cleaned = ruleDraft
      .map((r) => ({ ...r, text: r.text.trim() }))
      .filter((r) => r.text);
    setSavingRules(true);
    try {
      const res = await fetch(`/api/amenities/${id}/rules`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rules: cleaned.map(({ kind, text, displayOrder }, idx) => ({ kind, text, displayOrder: idx })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save rules");
      showToast("Rules saved");
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSavingRules(false);
    }
  };

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;
  if (!amenity) {
    return (
      <div className={styles.page}>
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Amenity not found</p>
          <Link href="/admin/amenities/list" className={styles.btn}>Back to all amenities</Link>
        </div>
      </div>
    );
  }

  const eff = amenity.effectiveStatus;
  const weekly = availability.filter((r) => r.type === "WEEKLY");

  return (
    <div className={styles.page}>
      <div className={styles.breadcrumb}>
        <Link href="/admin/amenities">Amenities</Link> / <Link href="/admin/amenities/list">All amenities</Link> / {amenity.name}
      </div>

      <div className={styles.detailHead}>
        <div>
          <h1 className={styles.title}>{amenity.name}</h1>
          <p className={styles.subtitle}>
            {amenity.categoryName}{amenity.location ? ` · ${amenity.location}` : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span
            className={`${styles.pill} ${amenity.status === "OPEN" ? styles.pillOpen : styles.pillClosed}`}
            title="Manual status — set via the Status action, overrides the weekly schedule below"
          >
            {label(amenity.status)} (manual)
          </span>
          {eff && (
            <span
              className={`${styles.pill} ${eff.state === "OPEN" ? styles.pillOpen : styles.pillClosed}`}
              title="Live status — computed right now from the weekly hours and any closures"
            >
              {eff.label} (live)
            </span>
          )}
          {amenity.liveOccupancy > 0 && (
            <span className={`${styles.pill} ${styles.pillInfo}`}>{amenity.liveOccupancy} inside</span>
          )}
        </div>
      </div>

      {eff && eff.state !== "OPEN" && (
        <div className={`${styles.banner} ${styles.bannerWarn}`}>
          <strong>{eff.label}</strong>
          {eff.reason ? ` — ${eff.reason}` : ""}
          {eff.nextOpenAt
            ? ` Reopens ${new Date(eff.nextOpenAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.`
            : ""}
        </div>
      )}

      <div className={styles.tabs}>
        {TABS.map((t) => (
          <button key={t} className={`${styles.tab} ${tab === t ? styles.tabActive : ""}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {/* ------------------------------------------------------------ Basics */}
      {tab === "Basics" && (
        <div className={styles.card} style={{ maxWidth: 640 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className={styles.field}>
              <label className={styles.label}>Name</label>
              <input className={styles.input} value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Category</label>
              <select className={styles.select} value={draft.categoryId}
                onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
                {categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Location</label>
              <input className={styles.input} value={draft.location}
                onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Description</label>
              <textarea className={styles.textarea} value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </div>
            <div className={styles.grid2}>
              <div className={styles.field}>
                <label className={styles.label}>Contact person</label>
                <input className={styles.input} value={draft.contactName}
                  onChange={(e) => setDraft({ ...draft, contactName: e.target.value })} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Contact phone</label>
                <input className={styles.input} value={draft.contactPhone}
                  onChange={(e) => setDraft({ ...draft, contactPhone: e.target.value })} />
              </div>
            </div>
            <label className={styles.checkRow}>
              <input type="checkbox" checked={draft.isActive}
                onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
              Active — visible to residents
            </label>
            <div style={{ display: "flex", gap: 10 }}>
              <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}
                onClick={() => patchAmenity({
                  name: draft.name, categoryId: draft.categoryId,
                  description: draft.description, location: draft.location,
                  isActive: draft.isActive,
                  contactPerson: { name: draft.contactName, phone: draft.contactPhone },
                }, "Basics saved")}>
                {saving ? "Saving…" : "Save basics"}
              </button>
              <button className={`${styles.btn} ${styles.btnDanger}`}
                onClick={async () => {
                  if (!confirm(`Delete "${amenity.name}"? Attendance and incident history is retained.`)) return;
                  const res = await fetch(`/api/amenities/${id}`, { method: "DELETE", credentials: "include" });
                  const data = await res.json();
                  if (!res.ok) return showToast(data.error || "Delete failed", "err");
                  router.push("/admin/amenities/list");
                }}>
                Delete amenity
              </button>
            </div>
            <p className={styles.hint}>
              Deleting hides the amenity but attendance, incidents and analytics keep referring to it,
              because those histories are required permanently.
            </p>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------ Availability */}
      {tab === "Availability" && (
        <div className={styles.grid2}>
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Weekly hours</h2>
            {!weekly.length && (
              <p className={styles.emptyText}>
                No weekly hours set — residents see this amenity as always open.
              </p>
            )}

            <div style={{ marginBottom: 16, padding: 10, background: "#f9fafb", borderRadius: 8 }}>
              <div className={styles.timeRow}>
                <span className={styles.hint}>Open</span>
                <input
                  type="time"
                  className={styles.input}
                  style={{ padding: "4px 6px", fontSize: 12 }}
                  value={quickOpen}
                  onChange={(e) => setQuickOpen(e.target.value)}
                />
                <span className={styles.hint}>–</span>
                <input
                  type="time"
                  className={styles.input}
                  style={{ padding: "4px 6px", fontSize: 12 }}
                  value={quickClose}
                  onChange={(e) => setQuickClose(e.target.value)}
                />
              </div>
              {quickBreaks.map((b) => (
                <div key={b.key} className={styles.timeRow} style={{ marginTop: 6 }}>
                  <span className={styles.hint}>Break</span>
                  <input
                    type="time"
                    className={styles.input}
                    style={{ padding: "4px 6px", fontSize: 12 }}
                    value={b.start}
                    onChange={(e) => updateBreak(b.key, "start", e.target.value)}
                  />
                  <span className={styles.hint}>–</span>
                  <input
                    type="time"
                    className={styles.input}
                    style={{ padding: "4px 6px", fontSize: 12 }}
                    value={b.end}
                    onChange={(e) => updateBreak(b.key, "end", e.target.value)}
                  />
                  <button type="button" className={`${styles.btn} ${styles.btnSm}`} onClick={() => removeBreak(b.key)}>
                    ×
                  </button>
                </div>
              ))}
              <div className={styles.timeRow} style={{ marginTop: 8 }}>
                {quickBreaks.length < 2 && (
                  <button type="button" className={`${styles.btn} ${styles.btnSm}`} onClick={addBreak}>
                    + Add break
                  </button>
                )}
                <button type="button" className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`} onClick={applyAllDays}>
                  Apply to all 7 days
                </button>
              </div>
              <p className={styles.hint} style={{ marginTop: 6 }}>
                Up to 2 breaks (e.g. lunch, cleaning) — applied to every day. Then just uncheck a day below to close it.
              </p>
            </div>

            <div className={styles.weekGrid}>
              {DAYS.map((d, i) => {
                const day = weeklyDraft.find((wd) => wd.dayOfWeek === i) || { windows: [] };
                const isOpen = day.windows.length > 0;
                const primary = day.windows[0];
                const extra = day.windows.slice(1);
                return (
                  <div key={d} style={{ display: "contents" }}>
                    <div className={styles.dayName}>
                      <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                        <input type="checkbox" checked={isOpen} onChange={(e) => toggleDayOpen(i, e.target.checked)} />
                        {d}
                      </label>
                    </div>
                    <div className={styles.timeRow}>
                      {!isOpen ? (
                        <span className={styles.hint}>Closed</span>
                      ) : (
                        <>
                          <input
                            type="time"
                            className={styles.input}
                            style={{ padding: "4px 6px", fontSize: 12 }}
                            value={primary.openTime}
                            onChange={(e) => updateWindow(i, primary.key, "openTime", e.target.value)}
                          />
                          <span className={styles.hint}>–</span>
                          <input
                            type="time"
                            className={styles.input}
                            style={{ padding: "4px 6px", fontSize: 12 }}
                            value={primary.closeTime}
                            onChange={(e) => updateWindow(i, primary.key, "closeTime", e.target.value)}
                          />
                          {extra.map((w) => (
                            <span key={w.key} className={styles.timeRow} style={{ gap: 4 }}>
                              <span className={styles.hint}>+</span>
                              <input
                                type="time"
                                className={styles.input}
                                style={{ padding: "4px 6px", fontSize: 12 }}
                                value={w.openTime}
                                onChange={(e) => updateWindow(i, w.key, "openTime", e.target.value)}
                              />
                              <span className={styles.hint}>–</span>
                              <input
                                type="time"
                                className={styles.input}
                                style={{ padding: "4px 6px", fontSize: 12 }}
                                value={w.closeTime}
                                onChange={(e) => updateWindow(i, w.key, "closeTime", e.target.value)}
                              />
                              <button type="button" className={`${styles.btn} ${styles.btnSm}`} onClick={() => removeWindow(i, w.key)}>
                                ×
                              </button>
                            </span>
                          ))}
                          <button type="button" className={`${styles.btn} ${styles.btnSm}`} onClick={() => addWindow(i)}>
                            + split shift
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className={styles.hint} style={{ marginTop: 14 }}>
              For a one-off holiday, don't uncheck the day here — use Closures below instead so it doesn't
              repeat every week.
            </p>
            <div style={{ marginTop: 14 }}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={saveAvailability}
                disabled={savingAvailability}
              >
                {savingAvailability ? "Saving…" : "Save weekly hours"}
              </button>
            </div>
          </div>

          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Closures</h2>
            {!closures.length ? (
              <p className={styles.emptyText}>No holiday or temporary closures scheduled.</p>
            ) : (
              <table className={styles.table}>
                <tbody>
                  {closures.map((c) => (
                    <tr key={c._id}>
                      <td>
                        <div className={styles.rowName}>{c.reason}</div>
                        <div className={styles.rowSub}>
                          {new Date(c.startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                          {" – "}
                          {new Date(c.endDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                        </div>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <span className={`${styles.pill} ${c.closureType === "HOLIDAY" ? styles.pillInfo : styles.pillTemp}`}>
                          {label(c.closureType)}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button className={`${styles.btn} ${styles.btnDanger} ${styles.btnSm}`}
                          onClick={() => removeClosure(c._id)}>
                          Cancel
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className={styles.hint} style={{ marginTop: 12 }}>
              Closures more than a week out appear here and on the resident page but send no notification —
              a holiday eight months away is not news.
            </p>

            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #f3f4f6", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <div className={styles.field} style={{ flex: "1 1 140px" }}>
                  <label className={styles.label}>Type</label>
                  <select className={styles.select} value={closureDraft.closureType}
                    onChange={(e) => setClosureDraft({ ...closureDraft, closureType: e.target.value })}>
                    <option value="HOLIDAY">Holiday</option>
                    <option value="TEMPORARY">Temporary</option>
                  </select>
                </div>
                <div className={styles.field} style={{ flex: "1 1 140px" }}>
                  <label className={styles.label}>Start date</label>
                  <input type="date" className={styles.input} value={closureDraft.startDate}
                    onChange={(e) => setClosureDraft({ ...closureDraft, startDate: e.target.value })} />
                </div>
                <div className={styles.field} style={{ flex: "1 1 140px" }}>
                  <label className={styles.label}>End date</label>
                  <input type="date" className={styles.input} value={closureDraft.endDate}
                    onChange={(e) => setClosureDraft({ ...closureDraft, endDate: e.target.value })} />
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Reason</label>
                <input className={styles.input} placeholder="e.g. Diwali, deep cleaning, pump repair"
                  value={closureDraft.reason}
                  onChange={(e) => setClosureDraft({ ...closureDraft, reason: e.target.value })} />
              </div>
              <button className={`${styles.btn} ${styles.btnPrimary}`} style={{ alignSelf: "flex-start" }}
                disabled={savingClosure} onClick={addClosure}>
                {savingClosure ? "Adding…" : "Add closure"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------- Access */}
      {tab === "Access" && (
        <div className={styles.card} style={{ maxWidth: 560 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className={styles.field}>
              <label className={styles.label}>Who may use this amenity</label>
              <select className={styles.select} value={draft.access?.audience || "EVERYONE"}
                onChange={(e) => setDraft({ ...draft, access: { ...draft.access, audience: e.target.value } })}>
                {AUDIENCES.map((a) => <option key={a} value={a}>{label(a)}</option>)}
              </select>
            </div>

            {draft.access?.audience === "CUSTOM" && (
              <div className={styles.field}>
                <label className={styles.label}>Custom roles</label>
                {!settings?.customAccessRoles?.length ? (
                  <p className={styles.hint}>
                    No custom roles configured yet. Add them in amenity settings first — the API rejects
                    roles that are not in the society list.
                  </p>
                ) : settings.customAccessRoles.map((role) => (
                  <label key={role} className={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={(draft.access?.customRoles || []).includes(role)}
                      onChange={(e) => {
                        const cur = draft.access?.customRoles || [];
                        setDraft({
                          ...draft,
                          access: {
                            ...draft.access,
                            customRoles: e.target.checked ? [...cur, role] : cur.filter((r) => r !== role),
                          },
                        });
                      }}
                    />
                    {role}
                  </label>
                ))}
              </div>
            )}

            <div className={styles.grid2}>
              <div className={styles.field}>
                <label className={styles.label}>Minimum age</label>
                <input className={styles.input} type="number" min={0} max={120}
                  value={draft.access?.minAge ?? ""}
                  onChange={(e) => setDraft({ ...draft, access: { ...draft.access, minAge: e.target.value === "" ? null : Number(e.target.value) } })} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Maximum age</label>
                <input className={styles.input} type="number" min={0} max={120}
                  value={draft.access?.maxAge ?? ""}
                  onChange={(e) => setDraft({ ...draft, access: { ...draft.access, maxAge: e.target.value === "" ? null : Number(e.target.value) } })} />
              </div>
            </div>
            <p className={styles.hint}>
              Age limits apply to resident self check-in. A guard recording a check-in can override them,
              and the override is recorded with a reason — someone standing in front of you may be a
              legitimate exception the rules cannot see.
            </p>

            <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}
              onClick={() => patchAmenity({ access: draft.access }, "Access rules saved")}>
              {saving ? "Saving…" : "Save access"}
            </button>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- Capacity */}
      {tab === "Capacity" && (
        <div className={styles.card} style={{ maxWidth: 520 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label className={styles.checkRow}>
              <input type="checkbox" checked={draft.capacity?.unlimited !== false}
                onChange={(e) => setDraft({ ...draft, capacity: { ...draft.capacity, unlimited: e.target.checked } })} />
              Unlimited capacity
            </label>

            {draft.capacity?.unlimited === false && (
              <>
                <div className={styles.field}>
                  <label className={styles.label}>Maximum occupancy</label>
                  <input className={styles.input} type="number" min={1}
                    value={draft.capacity?.maxOccupancy ?? ""}
                    onChange={(e) => setDraft({ ...draft, capacity: { ...draft.capacity, maxOccupancy: Number(e.target.value) } })} />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Warning threshold (%)</label>
                  <input className={styles.input} type="number" min={1} max={100}
                    value={draft.capacity?.warningThresholdPct ?? 80}
                    onChange={(e) => setDraft({ ...draft, capacity: { ...draft.capacity, warningThresholdPct: Number(e.target.value) } })} />
                  <span className={styles.hint}>
                    The dashboard turns amber at this point, so the guard can slow admissions before the
                    amenity becomes unpleasant rather than at the moment it is full.
                  </span>
                </div>
                {amenity.liveOccupancy > 0 && (
                  <div className={`${styles.banner} ${styles.bannerInfo}`} style={{ marginBottom: 0 }}>
                    {amenity.liveOccupancy} {amenity.liveOccupancy === 1 ? "person is" : "people are"} checked in
                    right now. The maximum cannot be set below that.
                  </div>
                )}
              </>
            )}

            <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}
              onClick={() => patchAmenity({ capacity: draft.capacity }, "Capacity saved")}>
              {saving ? "Saving…" : "Save capacity"}
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------ Slots */}
      {tab === "Slots" && (
        <div className={styles.grid2}>
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Slot policy</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <label className={styles.checkRow}>
                <input type="checkbox" checked={!!draft.slotPolicy?.enabled}
                  onChange={(e) => setDraft({ ...draft, slotPolicy: { ...draft.slotPolicy, enabled: e.target.checked } })} />
                Use time slots
              </label>
              <p className={styles.hint}>
                Booking is not enabled, but slots still attribute attendance, scope QR check-ins and give
                analytics a unit finer than a whole day. A gym typically needs none; a tennis court does.
              </p>

              {draft.slotPolicy?.enabled && (
                <>
                  <div className={styles.grid2}>
                    <div className={styles.field}>
                      <label className={styles.label}>Slot duration (min)</label>
                      <input className={styles.input} type="number" min={5} max={1440}
                        value={draft.slotPolicy?.slotDurationMins ?? 60}
                        onChange={(e) => setDraft({ ...draft, slotPolicy: { ...draft.slotPolicy, slotDurationMins: Number(e.target.value) } })} />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label}>Gap between slots (min)</label>
                      <input className={styles.input} type="number" min={0} max={240}
                        value={draft.slotPolicy?.gapBetweenSlotsMins ?? 0}
                        onChange={(e) => setDraft({ ...draft, slotPolicy: { ...draft.slotPolicy, gapBetweenSlotsMins: Number(e.target.value) } })} />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label}>Buffer time (min)</label>
                      <input className={styles.input} type="number" min={0} max={240}
                        value={draft.slotPolicy?.bufferTimeMins ?? 0}
                        onChange={(e) => setDraft({ ...draft, slotPolicy: { ...draft.slotPolicy, bufferTimeMins: Number(e.target.value) } })} />
                      <span className={styles.hint}>Trimmed off the end of each slot for cleaning or changeover.</span>
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label}>Capacity per slot</label>
                      <input className={styles.input} type="number" min={1}
                        value={draft.slotPolicy?.maxCapacityPerSlot ?? ""}
                        onChange={(e) => setDraft({ ...draft, slotPolicy: { ...draft.slotPolicy, maxCapacityPerSlot: e.target.value === "" ? null : Number(e.target.value) } })} />
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    <button className={styles.btn} disabled={saving}
                      onClick={async () => {
                        // Dry run first: regenerating replaces generated slots, so
                        // showing the count beforehand is worth the extra call.
                        const res = await fetch(`/api/amenities/${id}/slots`, {
                          method: "POST", credentials: "include",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ ...draft.slotPolicy, dryRun: true }),
                        });
                        const data = await res.json();
                        if (!res.ok) return showToast(data.error || "Preview failed", "err");
                        showToast(`Would generate ${data.generated} slots across the week`);
                      }}>
                      Preview
                    </button>
                    <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}
                      onClick={async () => {
                        await patchAmenity({ slotPolicy: draft.slotPolicy }, "Slot policy saved");
                        const res = await fetch(`/api/amenities/${id}/slots`, {
                          method: "POST", credentials: "include",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({}),
                        });
                        const data = await res.json();
                        if (res.ok) showToast(`${data.created} slots generated`);
                        load();
                      }}>
                      Save and regenerate
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className={styles.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h2 className={styles.cardTitle} style={{ margin: 0 }}>Generated slots</h2>
              {!!slots.length && (
                selectingSlots ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span className={styles.hint}>{selectedSlotIds.length} selected</span>
                    <button type="button" className={`${styles.btn} ${styles.btnSm}`}
                      onClick={() => setSelectedSlotIds(slots.map((s) => s._id))}>
                      Select all
                    </button>
                    <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnDanger}`}
                      disabled={savingSlot || !selectedSlotIds.length} onClick={() => deleteSlots(selectedSlotIds)}>
                      Delete selected
                    </button>
                    <button type="button" className={`${styles.btn} ${styles.btnSm}`}
                      onClick={() => { setSelectingSlots(false); setSelectedSlotIds([]); }}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button type="button" className={`${styles.btn} ${styles.btnSm}`} onClick={() => setSelectingSlots(true)}>
                    Select slots to delete
                  </button>
                )
              )}
            </div>
            {!slots.length ? (
              <p className={styles.emptyText}>No slots yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {DAYS.map((d, i) => {
                  const rows = slots.filter((s) => s.dayOfWeek === i && s.isActive !== false);
                  if (!rows.length && selectingSlots) return null;
                  return (
                    <div key={d}>
                      <div className={styles.dayName} style={{ marginBottom: 5 }}>{d}</div>
                      <div className={styles.slotChips}>
                        {rows.map((s) => {
                          const picked = selectedSlotIds.includes(s._id);
                          return (
                            <button
                              key={s._id}
                              type="button"
                              className={`${styles.slotChip} ${s.isCustom ? styles.slotCustom : ""}`}
                              style={selectingSlots
                                ? { cursor: "pointer", outline: picked ? "2px solid #b91c1c" : "1px solid transparent", background: picked ? "#fef2f2" : undefined }
                                : { cursor: "pointer" }}
                              title={selectingSlots ? "Click to select" : "Click to edit"}
                              onClick={() => (selectingSlots
                                ? setSelectedSlotIds((prev) => (picked ? prev.filter((x) => x !== s._id) : [...prev, s._id]))
                                : setEditingSlot({
                                  dayOfWeek: i, startTime: s.startTime, endTime: s.endTime,
                                  capacity: s.capacity ?? "", label: s.label || "", isNew: false,
                                }))}
                            >
                              {selectingSlots ? (picked ? "☑ " : "☐ ") : ""}
                              {s.startTime}–{s.endTime}
                              {s.capacity ? ` · ${s.capacity}` : ""}
                            </button>
                          );
                        })}
                        {!selectingSlots && (
                          <button
                            type="button"
                            className={styles.slotChip}
                            style={{ cursor: "pointer", background: "transparent", border: "1px dashed #9ca3af" }}
                            onClick={() => setEditingSlot({
                              dayOfWeek: i, startTime: "", endTime: "", capacity: "", label: "", isNew: true,
                            })}
                          >
                            + Add
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                <p className={styles.hint}>
                  {selectingSlots
                    ? "Tick the slots you want gone, then Delete selected."
                    : "Highlighted slots were created by hand and are preserved when the grid is regenerated. Click any slot to edit its time or capacity, or add one by hand."}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {editingSlot && (
        <div className={styles.overlay} onClick={() => !savingSlot && setEditingSlot(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h2 className={styles.modalTitle}>
                {editingSlot.isNew ? "Add slot" : "Edit slot"} · {DAYS[editingSlot.dayOfWeek]}
              </h2>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.grid2}>
                <div className={styles.field}>
                  <label className={styles.label}>Start time</label>
                  <input className={styles.timeInput} type="time" value={editingSlot.startTime}
                    onChange={(e) => setEditingSlot({ ...editingSlot, startTime: e.target.value })} />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>End time</label>
                  <input className={styles.timeInput} type="time" value={editingSlot.endTime}
                    onChange={(e) => setEditingSlot({ ...editingSlot, endTime: e.target.value })} />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Capacity (optional)</label>
                  <input className={styles.input} type="number" min={1} value={editingSlot.capacity}
                    onChange={(e) => setEditingSlot({ ...editingSlot, capacity: e.target.value })} />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Label (optional)</label>
                  <input className={styles.input} type="text" maxLength={80} value={editingSlot.label}
                    onChange={(e) => setEditingSlot({ ...editingSlot, label: e.target.value })} />
                </div>
              </div>
            </div>
            <div className={styles.modalFoot} style={{ justifyContent: "space-between" }}>
              {!editingSlot.isNew ? (
                <button className={`${styles.btn} ${styles.btnDanger}`} disabled={savingSlot}
                  onClick={() => removeSlot(editingSlot)}>
                  Remove
                </button>
              ) : <span />}
              <div style={{ display: "flex", gap: 8 }}>
                <button className={styles.btn} disabled={savingSlot} onClick={() => setEditingSlot(null)}>
                  Cancel
                </button>
                <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={savingSlot}
                  onClick={() => {
                    if (!editingSlot.startTime || !editingSlot.endTime) {
                      return showToast("Start and end time are required", "err");
                    }
                    if (editingSlot.endTime <= editingSlot.startTime) {
                      return showToast("End time must be after start time", "err");
                    }
                    saveSlot(editingSlot.isNew ? null : editingSlot, editingSlot);
                  }}>
                  {savingSlot ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------ Rules */}
      {tab === "Rules" && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Rulebook</h2>
          <div className={styles.ruleCols}>
            {RULE_KINDS.map(([kind, heading]) => {
              const rows = ruleDraft.filter((r) => r.kind === kind);
              return (
                <div key={kind}>
                  <div className={styles.dayName} style={{ marginBottom: 9 }}>{heading}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {rows.map((r) => (
                      <div key={r.key} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                        <input
                          className={styles.input}
                          style={{ flex: 1 }}
                          value={r.text}
                          maxLength={240}
                          placeholder={`Add a ${heading.toLowerCase()} line…`}
                          onChange={(e) => setRuleDraft(ruleDraft.map((row) =>
                            row.key === r.key ? { ...row, text: e.target.value } : row))}
                        />
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnSm}`}
                          title="Remove"
                          onClick={() => setRuleDraft(ruleDraft.filter((row) => row.key !== r.key))}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnSm}`}
                      style={{ alignSelf: "flex-start" }}
                      onClick={() => setRuleDraft([...ruleDraft, { key: newRuleKey(), kind, text: "", displayOrder: ruleDraft.length }])}
                    >
                      + Add
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className={styles.hint} style={{ marginTop: 16 }}>
            Rules are saved as a complete set. Retired rules are deactivated rather than deleted, so an
            incident raised for a rule violation still resolves to the rule as it stood that day. Blank
            lines are dropped on save.
          </p>
          <button className={`${styles.btn} ${styles.btnPrimary}`} style={{ marginTop: 14 }}
            disabled={savingRules} onClick={saveRules}>
            {savingRules ? "Saving…" : "Save rulebook"}
          </button>
        </div>
      )}

      {/* --------------------------------------------------------- Visitors */}
      {tab === "Visitors" && (
        <div className={styles.card} style={{ maxWidth: 560 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label className={styles.checkRow}>
              <input type="checkbox" checked={!!draft.visitorPolicy?.allowed}
                onChange={(e) => setDraft({ ...draft, visitorPolicy: { ...draft.visitorPolicy, allowed: e.target.checked } })} />
              Visitors allowed
            </label>

            {draft.visitorPolicy?.allowed && (
              <>
                <div className={styles.grid2}>
                  <div className={styles.field}>
                    <label className={styles.label}>Max visitors per resident</label>
                    <input className={styles.input} type="number" min={0} max={100}
                      value={draft.visitorPolicy?.maxVisitorsPerResident ?? 2}
                      onChange={(e) => setDraft({ ...draft, visitorPolicy: { ...draft.visitorPolicy, maxVisitorsPerResident: Number(e.target.value) } })} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Max visitors in total</label>
                    <input className={styles.input} type="number" min={0}
                      value={draft.visitorPolicy?.maxVisitorsTotal ?? ""}
                      onChange={(e) => setDraft({ ...draft, visitorPolicy: { ...draft.visitorPolicy, maxVisitorsTotal: e.target.value === "" ? null : Number(e.target.value) } })} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Allowed from</label>
                    <input className={styles.timeInput} type="time"
                      value={draft.visitorPolicy?.allowedFrom || ""}
                      onChange={(e) => setDraft({ ...draft, visitorPolicy: { ...draft.visitorPolicy, allowedFrom: e.target.value } })} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Allowed until</label>
                    <input className={styles.timeInput} type="time"
                      value={draft.visitorPolicy?.allowedTo || ""}
                      onChange={(e) => setDraft({ ...draft, visitorPolicy: { ...draft.visitorPolicy, allowedTo: e.target.value } })} />
                  </div>
                </div>
                <label className={styles.checkRow}>
                  <input type="checkbox" checked={!!draft.visitorPolicy?.approvalRequired}
                    onChange={(e) => setDraft({ ...draft, visitorPolicy: { ...draft.visitorPolicy, approvalRequired: e.target.checked } })} />
                  Committee approval required before entry
                </label>
              </>
            )}

            <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}
              onClick={() => patchAmenity({ visitorPolicy: draft.visitorPolicy }, "Visitor policy saved")}>
              {saving ? "Saving…" : "Save visitor policy"}
            </button>
          </div>
        </div>
      )}

      {/* --------------------------------------------------- Attendance & QR */}
      {tab === "Attendance & QR" && (
        <div className={styles.grid2}>
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Attendance mode</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {MODES.map((m) => (
                <label key={m} className={styles.checkRow}>
                  <input type="radio" name="mode" checked={draft.attendanceMode === m}
                    onChange={() => setDraft({ ...draft, attendanceMode: m })} />
                  {m === "QR_MANUAL" ? "QR with manual override" : label(m)}
                </label>
              ))}
              <p className={styles.hint}>
                QR with manual override is usually the right answer in practice: residents self-scan, and a
                guard can still admit someone whose phone is flat rather than turning them away.
              </p>
              <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}
                onClick={() => patchAmenity({ attendanceMode: draft.attendanceMode }, "Attendance mode saved")}>
                {saving ? "Saving…" : "Save mode"}
              </button>
            </div>
          </div>

          <div className={styles.card}>
            <h2 className={styles.cardTitle}>QR code</h2>
            {qr && qr.isActive ? (
              <div>
                <p style={{ fontSize: 13, color: "#374151", margin: "0 0 8px" }}>
                  Active code{qr.label ? ` · ${qr.label}` : ""} · {qr.mode}
                </p>
                <p className={styles.hint}>
                  Scanned {qr.scanCount || 0} times.
                  {qr.lastScannedAt
                    ? ` Last used ${new Date(qr.lastScannedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.`
                    : " Not used yet."}
                </p>
                <p className={styles.hint} style={{ marginTop: 10 }}>
                  The scannable value is not shown again — only a hash is stored, which is what makes a
                  leaked screenshot recoverable by revoking rather than a permanent problem.
                </p>
                <button className={`${styles.btn} ${styles.btnDanger} ${styles.btnSm}`} style={{ marginTop: 12 }}
                  onClick={async () => {
                    if (!confirm("Revoke this code? Printed copies stop working immediately.")) return;
                    const res = await fetch(`/api/amenities/${id}/qr?tokenId=${qr._id}`, {
                      method: "DELETE", credentials: "include",
                    });
                    if (!res.ok) return showToast("Could not revoke the code", "err");
                    showToast("Code revoked");
                    load();
                  }}>
                  Revoke
                </button>
              </div>
            ) : (
              <div>
                <p className={styles.emptyText}>No active code for this amenity.</p>
                <button className={`${styles.btn} ${styles.btnPrimary}`} style={{ marginTop: 12 }}
                  onClick={async () => {
                    const res = await fetch(`/api/amenities/${id}/qr`, {
                      method: "POST", credentials: "include",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ mode: "STATIC" }),
                    });
                    const data = await res.json();
                    if (!res.ok) return showToast(data.error || "Could not generate a code", "err");
                    setNewToken(data.qr);
                    load();
                  }}>
                  Generate QR code
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------ Maintenance */}
      {tab === "Maintenance" && (
        <div className={styles.tableWrap}>
          {!maintenance.length ? (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>No maintenance history</p>
              <p className={styles.emptyText}>
                Schedule maintenance from the <Link href="/admin/amenities/maintenance">maintenance calendar</Link>.
              </p>
            </div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Reason</th><th style={{ width: 200 }}>Window</th>
                  <th style={{ width: 130 }}>Status</th><th style={{ width: 150 }}>Recorded by</th>
                </tr>
              </thead>
              <tbody>
                {maintenance.map((m) => (
                  <tr key={m._id}>
                    <td>
                      <div className={styles.rowName}>{m.reason}</div>
                      {m.extensions?.length ? (
                        <div className={styles.rowSub}>Extended {m.extensions.length}×</div>
                      ) : null}
                      {m.reopenedEarly ? <div className={styles.rowSub}>Reopened early</div> : null}
                    </td>
                    <td>
                      {new Date(m.startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      {" – "}
                      {new Date(m.actualEndDate || m.endDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td>
                      <span className={`${styles.pill} ${m.status === "COMPLETED" ? styles.pillOpen : m.status === "CANCELLED" ? styles.pillMuted : styles.pillMaint}`}>
                        {label(m.status)}
                      </span>
                    </td>
                    <td className={styles.rowSub}>{m.createdByName || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {newToken && (
        <div className={styles.overlay} onClick={() => setNewToken(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}><h2 className={styles.modalTitle}>QR code generated</h2></div>
            <div className={styles.modalBody}>
              <div className={`${styles.banner} ${styles.bannerWarn}`} style={{ marginBottom: 0 }}>
                This is the only time the code is shown. Only a hash is stored, so it cannot be retrieved
                later — print it now, or generate a fresh one.
              </div>
              <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
                {qrImage ? (
                  <img src={qrImage} width={220} height={220} alt="Scannable QR code" />
                ) : (
                  <div style={{ width: 220, height: 220, display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: 12 }}>
                    Rendering…
                  </div>
                )}
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Token</label>
                <textarea className={styles.textarea} readOnly value={newToken.token || ""}
                  onClick={(e) => e.target.select()} style={{ fontFamily: "monospace", fontSize: 12 }} />
              </div>
              {newToken.deepLink ? (
                <div className={styles.field}>
                  <label className={styles.label}>Deep link</label>
                  <input className={styles.input} readOnly value={newToken.deepLink}
                    onClick={(e) => e.target.select()} style={{ fontFamily: "monospace", fontSize: 12 }} />
                </div>
              ) : null}
            </div>
            <div className={styles.modalFoot}>
              {qrImage ? (
                <a
                  className={styles.btn}
                  href={qrImage}
                  download={`amenity-qr-${id}.png`}
                >
                  Download PNG
                </a>
              ) : null}
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setNewToken(null)}>Done</button>
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

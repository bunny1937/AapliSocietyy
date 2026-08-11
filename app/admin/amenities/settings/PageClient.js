"use client";
import { useState, useEffect } from "react";
import styles from "@/styles/Amenities.module.css";

// Flags the society can turn on now. The remainder exist in the schema but are
// deferred scope, so they are listed read-only rather than offered as switches
// that would enable half-built surfaces.
const LIVE_FLAGS = [
  ["timeSlots", "Time slots", "Divide operating hours into slots. Drives attendance and analytics even with booking off."],
  ["capacityLimits", "Capacity limits", "Cap concurrent occupancy and warn before it is reached."],
  ["visitorAccess", "Visitor access", "Let residents bring guests, with optional approval."],
  ["attendance", "Attendance", "Record who used an amenity and for how long."],
  ["qrCheckIn", "QR check-in", "Residents scan a code at the door to check in and out."],
  ["events", "Events", "Host events at an amenity with registration."],
  ["waitlists", "Waitlists", "Queue residents for full events and promote automatically."],
  ["analytics", "Analytics", "Usage dashboards and exports."],
  ["incidents", "Incidents", "Report and track damage, hazards and rule violations."],
];

const DEFERRED = [
  "bookings", "bookingApprovals", "onlinePayments", "securityDeposits", "refunds",
  "penalties", "equipmentRentals", "consumableInventory", "recurringReservations",
  "occupancyPrediction", "iotIntegration", "dynamicQrRotation", "geofencedCheckIn",
  "faceRecognition", "digitalWaiver", "billingIntegration", "loyaltyPoints",
  "calendarSync", "publicApi",
];

function TagEditor({ label, hint, values, onChange, placeholder }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (values.some((x) => x.toLowerCase() === v.toLowerCase())) { setDraft(""); return; }
    onChange([...values, v]);
    setDraft("");
  };
  return (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      {hint ? <span className={styles.hint}>{hint}</span> : null}
      <div className={styles.slotChips} style={{ margin: "6px 0" }}>
        {values.length === 0 ? <span className={styles.hint}>None configured</span> : null}
        {values.map((v) => (
          <span key={v} className={styles.slotChip}>
            {v}
            <button
              onClick={() => onChange(values.filter((x) => x !== v))}
              style={{ border: "none", background: "none", cursor: "pointer", color: "#9ca3af", marginLeft: 5, padding: 0 }}
              aria-label={`Remove ${v}`}
            >×</button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          className={styles.input}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          style={{ flex: 1 }}
        />
        <button className={styles.btn} onClick={add}>Add</button>
      </div>
    </div>
  );
}

export default function AmenitySettingsPage() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  useEffect(() => {
    fetch("/api/amenities/settings", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setSettings(d.settings || null))
      .catch(() => showToast("Could not load settings", "err"))
      .finally(() => setLoading(false));
  }, []);

  const set = (patch) => setSettings((s) => ({ ...s, ...patch }));
  const setFlag = (key, on) => setSettings((s) => ({ ...s, features: { ...s.features, [key]: on } }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/amenities/settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          features: settings.features,
          incidentTypes: settings.incidentTypes,
          customAccessRoles: settings.customAccessRoles,
          visitorTypes: settings.visitorTypes,
          timezone: settings.timezone,
          autoCheckoutAfterMins: Number(settings.autoCheckoutAfterMins),
          eventReminderLeadMins: Number(settings.eventReminderLeadMins),
          waitlistHoldMins: Number(settings.waitlistHoldMins),
          notifyOnStatusChange: settings.notifyOnStatusChange,
          notifyOnRulesUpdate: settings.notifyOnRulesUpdate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save settings");
      setSettings(data.settings);
      showToast("Settings saved");
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading settings…</div></div>;
  if (!settings) return <div className={styles.page}><div className={styles.empty}>Settings unavailable.</div></div>;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Amenity settings</h1>
          <p className={styles.subtitle}>Society-wide configuration — individual amenities can override features</p>
        </div>
        <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>

      <div className={styles.grid2}>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Features</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            {LIVE_FLAGS.map(([key, name, desc]) => (
              <label key={key} className={styles.checkRow} style={{ alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={!!settings.features?.[key]}
                  onChange={(e) => setFlag(key, e.target.checked)}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <strong style={{ fontWeight: 600 }}>{name}</strong>
                  <div className={styles.hint}>{desc}</div>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Timing</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className={styles.field}>
              <label className={styles.label}>Timezone</label>
              <input className={styles.input} value={settings.timezone || ""}
                onChange={(e) => set({ timezone: e.target.value })} placeholder="Asia/Kolkata" />
              <span className={styles.hint}>
                Every daily metric is bucketed in this timezone. Getting it wrong shifts check-ins made
                late at night into the wrong day.
              </span>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Auto check-out after (minutes)</label>
              <input className={styles.input} type="number" min={15} max={1440}
                value={settings.autoCheckoutAfterMins ?? 240}
                onChange={(e) => set({ autoCheckoutAfterMins: e.target.value })} />
              <span className={styles.hint}>
                Residents forget to check out. Sessions open longer than this are closed automatically and
                flagged as estimated, so they are never confused with an observed check-out.
              </span>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Event reminder lead time (minutes)</label>
              <input className={styles.input} type="number" min={5} max={10080}
                value={settings.eventReminderLeadMins ?? 120}
                onChange={(e) => set({ eventReminderLeadMins: e.target.value })} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Waitlist hold (minutes)</label>
              <input className={styles.input} type="number" min={5} max={10080}
                value={settings.waitlistHoldMins ?? 1440}
                onChange={(e) => set({ waitlistHoldMins: e.target.value })} />
              <span className={styles.hint}>
                How long a promoted resident keeps their seat before it passes to the next in queue.
              </span>
            </div>
          </div>
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Vocabulary</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <TagEditor
              label="Incident types"
              hint="Residents pick from this list when reporting a problem."
              values={settings.incidentTypes || []}
              onChange={(v) => set({ incidentTypes: v })}
              placeholder="Equipment failure"
            />
            <TagEditor
              label="Custom access roles"
              hint="Extra audiences beyond owners, tenants, staff and committee."
              values={settings.customAccessRoles || []}
              onChange={(v) => set({ customAccessRoles: v })}
              placeholder="Senior citizens"
            />
            <TagEditor
              label="Visitor types"
              hint="Leave empty to allow any visitor type."
              values={settings.visitorTypes || []}
              onChange={(v) => set({ visitorTypes: v })}
              placeholder="Guest"
            />
          </div>
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Notifications</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            <label className={styles.checkRow} style={{ alignItems: "flex-start" }}>
              <input type="checkbox" checked={settings.notifyOnStatusChange !== false}
                onChange={(e) => set({ notifyOnStatusChange: e.target.checked })} style={{ marginTop: 3 }} />
              <span>
                <strong style={{ fontWeight: 600 }}>Notify on status change</strong>
                <div className={styles.hint}>
                  Emergency closures are sent regardless — that is the one case where this preference
                  should not win.
                </div>
              </span>
            </label>
            <label className={styles.checkRow} style={{ alignItems: "flex-start" }}>
              <input type="checkbox" checked={settings.notifyOnRulesUpdate !== false}
                onChange={(e) => set({ notifyOnRulesUpdate: e.target.checked })} style={{ marginTop: 3 }} />
              <span>
                <strong style={{ fontWeight: 600 }}>Notify on rules update</strong>
                <div className={styles.hint}>Only fires when the rules actually change, never on a no-op save.</div>
              </span>
            </label>
          </div>

          <h2 className={styles.cardTitle} style={{ marginTop: 24 }}>Deferred features</h2>
          <p className={styles.hint} style={{ marginBottom: 10 }}>
            Reserved in the schema and switched off. They are listed here so the roadmap is visible, but
            they are not offered as switches because the surfaces behind them are not built.
          </p>
          <div className={styles.slotChips}>
            {DEFERRED.map((f) => <span key={f} className={styles.slotChip}>{f}</span>)}
          </div>
        </div>
      </div>

      {toast && (
        <div className={`${styles.toast} ${toast.type === "err" ? styles.toastErr : styles.toastOk}`}>{toast.msg}</div>
      )}
    </div>
  );
}

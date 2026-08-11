"use client";
import { useState, useEffect, useCallback } from "react";
import styles from "@/styles/Amenities.module.css";

const iso = (d) => d.toISOString().slice(0, 10);
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const GRANULARITIES = ["daily", "weekly", "monthly", "yearly"];
const PRESETS = [
  ["7d", "Last 7 days", 7],
  ["30d", "Last 30 days", 30],
  ["90d", "Last 90 days", 90],
  ["365d", "Last year", 365],
];
const hourLabel = (h) => (h === 0 ? "12a" : h === 12 ? "12p" : h < 12 ? `${h}a` : `${h - 12}p`);
const dur = (m) => {
  if (!m) return "0h";
  const h = Math.floor(m / 60);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m % 60}m`;
};

/** Horizontal bar row — deliberately CSS-only. Pulling in a charting library for
 *  this would add weight to every admin bundle for six bars and a heatmap. */
function BarRow({ label, value, max, suffix }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className={styles.barRow}>
      <div className={styles.barLabel} title={label}>{label}</div>
      <div className={styles.barTrack}>
        <div className={styles.barFill} style={{ width: `${Math.max(pct, 1)}%` }} />
      </div>
      <div className={styles.barValue}>{value}{suffix || ""}</div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState(null);
  const [amenities, setAmenities] = useState([]);
  const [amenityId, setAmenityId] = useState("all");
  const [granularity, setGranularity] = useState("daily");
  const [preset, setPreset] = useState("30d");
  const [range, setRange] = useState(() => ({
    from: iso(new Date(Date.now() - 29 * 86400000)),
    to: iso(new Date()),
  }));
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 5000);
  };

  const applyPreset = (key, days) => {
    setPreset(key);
    setRange({ from: iso(new Date(Date.now() - (days - 1) * 86400000)), to: iso(new Date()) });
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to, granularity });
      if (amenityId !== "all") params.set("amenityId", amenityId);
      const res = await fetch(`/api/amenities/analytics?${params}`, { credentials: "include" });
      const body = await res.json();
      if (res.ok) setData(body.analytics || body);
      else showToast(body.error || "Could not load analytics", "err");
    } finally {
      setLoading(false);
    }
  }, [range, granularity, amenityId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch("/api/amenities?limit=100", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setAmenities(d.amenities || []))
      .catch(() => {});
  }, []);

  const recompute = async () => {
    setRecomputing(true);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      if (amenityId !== "all") params.set("amenityId", amenityId);
      const res = await fetch(`/api/amenities/analytics/recompute?${params}`, {
        method: "POST", credentials: "include",
      });
      const body = await res.json();
      if (!res.ok) return showToast(body.error || "Recompute failed", "err");
      showToast(`Rebuilt ${body.recomputed} day(s) from raw attendance`);
      load();
    } finally {
      setRecomputing(false);
    }
  };

  const exportUrl = () => {
    const params = new URLSearchParams({ from: range.from, to: range.to });
    if (amenityId !== "all") params.set("amenityId", amenityId);
    return `/api/amenities/analytics/export?${params}`;
  };

  const totals = data?.totals || {};
  // hourly is [{ hour, checkIns }, ...24 entries], not a plain count array.
  const hourlyCounts = (data?.hourly || []).map((h) => h.checkIns || 0);
  const maxHour = Math.max(1, ...hourlyCounts);
  const mostUsed = data?.mostUsed || [];
  const leastUsed = data?.leastUsed || [];
  const peakDays = data?.peakDays || [];
  const maxUsed = Math.max(1, ...mostUsed.map((a) => a.checkIns || 0));
  const maxDay = Math.max(1, ...peakDays.map((d) => d.checkIns || 0));
  const series = data?.series || [];
  const maxSeries = Math.max(1, ...series.map((s) => s.checkIns || 0));

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Usage analytics</h1>
          <p className={styles.subtitle}>{range.from} to {range.to}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={styles.btn} onClick={recompute} disabled={recomputing}
            title="Rebuild the rollup for this range from raw attendance — use this if numbers look stale or missing">
            {recomputing ? "Recomputing…" : "Recompute"}
          </button>
          <a className={styles.btn} href={exportUrl()} download>Export CSV</a>
          <button className={styles.btn} onClick={() => window.print()}>Print / PDF</button>
        </div>
      </div>

      <div className={styles.toolbar}>
        {PRESETS.map(([key, text, days]) => (
          <button key={key} className={`${styles.tab} ${preset === key ? styles.tabActive : ""}`}
            onClick={() => applyPreset(key, days)}>
            {text}
          </button>
        ))}
        <input className={styles.input} type="date" value={range.from}
          onChange={(e) => { setPreset(""); setRange({ ...range, from: e.target.value }); }} />
        <span className={styles.hint}>to</span>
        <input className={styles.input} type="date" value={range.to}
          onChange={(e) => { setPreset(""); setRange({ ...range, to: e.target.value }); }} />
        <select className={styles.select} value={amenityId} onChange={(e) => setAmenityId(e.target.value)}>
          <option value="all">All amenities</option>
          {amenities.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
        </select>
        <select className={styles.select} value={granularity} onChange={(e) => setGranularity(e.target.value)}>
          {GRANULARITIES.map((g) => (
            <option key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className={styles.loading}>Crunching numbers…</div>
      ) : !data ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>No data</p>
          <p className={styles.emptyText}>Analytics appear once residents start checking in.</p>
        </div>
      ) : (
        <>
          <div className={styles.statGrid}>
            <div className={styles.stat}>
              <div className={styles.statLabel}>Check-ins</div>
              <div className={styles.statValue}>{totals.checkIns || 0}</div>
              <div className={styles.statHint}>
                {totals.residentCheckIns || 0} resident · {totals.visitorCheckIns || 0} visitor
              </div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statLabel}>Unique residents</div>
              <div className={styles.statValue}>{totals.uniqueMembers || 0}</div>
              <div className={styles.statHint}>distinct people, not visits</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statLabel}>Average visit</div>
              <div className={styles.statValue}>{totals.avgDurationMins ? `${Math.round(totals.avgDurationMins)}m` : "—"}</div>
              <div className={styles.statHint}>closed sessions only</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statLabel}>Capacity used</div>
              <div className={styles.statValue}>
                {totals.capacityUtilisationPct != null ? `${Math.round(totals.capacityUtilisationPct)}%` : "—"}
              </div>
              <div className={styles.statHint}>peak occupancy against the cap</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statLabel}>Downtime</div>
              <div className={styles.statValue}>{dur(totals.maintenanceDowntimeMins || 0)}</div>
              <div className={styles.statHint}>actual, not scheduled</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statLabel}>QR share</div>
              <div className={styles.statValue}>
                {totals.checkIns ? `${Math.round(((totals.qrCheckIns || 0) / totals.checkIns) * 100)}%` : "—"}
              </div>
              <div className={styles.statHint}>
                {totals.manualCheckIns || 0} manual · {totals.overrideCheckIns || 0} override
              </div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statLabel}>Events held</div>
              <div className={styles.statValue}>{totals.eventsHeld || 0}</div>
              <div className={styles.statHint}>{totals.eventAttendance || 0} attendances</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statLabel}>Incidents</div>
              <div className={styles.statValue}>{totals.incidentsReported || 0}</div>
              <div className={styles.statHint}>reported in this range</div>
            </div>
          </div>

          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Peak hours</h2>
            {!hourlyCounts.length ? (
              <p className={styles.emptyText}>No check-ins in this range.</p>
            ) : (
              <>
                <div className={styles.heat}>
                  {hourlyCounts.map((count, h) => {
                    const intensity = count / maxHour;
                    return (
                      <div
                        key={h}
                        className={styles.heatCell}
                        title={`${hourLabel(h)} — ${count} check-ins`}
                        style={{
                          background: count === 0
                            ? "#f3f4f6"
                            : `rgba(37, 99, 235, ${0.15 + intensity * 0.8})`,
                          color: intensity > 0.55 ? "#fff" : "#374151",
                        }}
                      >
                        {count || ""}
                      </div>
                    );
                  })}
                </div>
                <div className={styles.heatLabels}>
                  {hourlyCounts.map((_, h) => (
                    <div key={h} className={styles.heatLabel}>{h % 3 === 0 ? hourLabel(h) : ""}</div>
                  ))}
                </div>
                {data.peakHours?.length ? (
                  <p className={styles.hint} style={{ marginTop: 12 }}>
                    Busiest: {data.peakHours.slice(0, 3).map((p) => `${hourLabel(p.hour)} (${p.checkIns})`).join(", ")}.
                    Worth aligning cleaning and maintenance windows away from these.
                  </p>
                ) : null}
              </>
            )}
          </div>

          <div className={styles.grid2}>
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Most used</h2>
              {!mostUsed.length ? (
                <p className={styles.emptyText}>Nothing recorded yet.</p>
              ) : mostUsed.map((a) => (
                <BarRow key={a.amenityId} label={a.amenityName} value={a.checkIns || 0} max={maxUsed} />
              ))}
            </div>

            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Least used</h2>
              {!leastUsed.length ? (
                <p className={styles.emptyText}>Nothing recorded yet.</p>
              ) : (
                <>
                  {leastUsed.map((a) => (
                    <BarRow key={a.amenityId} label={a.amenityName} value={a.checkIns || 0} max={maxUsed} />
                  ))}
                  <p className={styles.hint} style={{ marginTop: 12 }}>
                    An amenity at zero is not automatically waste — check whether it was closed or under
                    maintenance for much of this range before drawing a conclusion.
                  </p>
                </>
              )}
            </div>

            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Peak days</h2>
              {!peakDays.length ? (
                <p className={styles.emptyText}>No data.</p>
              ) : peakDays.map((d) => (
                <BarRow key={d.dayOfWeek} label={DAY_SHORT[d.dayOfWeek] || String(d.dayOfWeek)}
                  value={d.checkIns || 0} max={maxDay} />
              ))}
            </div>

            <div className={styles.card}>
              <h2 className={styles.cardTitle}>
                Trend · {granularity}
              </h2>
              {!series.length ? (
                <p className={styles.emptyText}>No data.</p>
              ) : (
                <div style={{ maxHeight: 320, overflowY: "auto" }}>
                  {series.map((s) => (
                    <BarRow key={s.bucket} label={s.bucket} value={s.checkIns || 0} max={maxSeries} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {data.perAmenity?.length ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Amenity</th><th style={{ width: 100 }}>Check-ins</th>
                    <th style={{ width: 100 }}>Unique</th><th style={{ width: 110 }}>Avg visit</th>
                    <th style={{ width: 110 }}>Peak occ.</th><th style={{ width: 110 }}>Downtime</th>
                    <th style={{ width: 100 }}>Incidents</th>
                  </tr>
                </thead>
                <tbody>
                  {data.perAmenity.map((a) => (
                    <tr key={a.amenityId}>
                      <td><span className={styles.rowName}>{a.amenityName}</span></td>
                      <td>{a.checkIns || 0}</td>
                      <td>{a.uniqueMembers || 0}</td>
                      <td>{a.avgDurationMins ? `${Math.round(a.avgDurationMins)}m` : "—"}</td>
                      <td>{a.peakOccupancy || 0}</td>
                      <td>{dur(a.maintenanceDowntimeMins || 0)}</td>
                      <td>{a.incidentsReported || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <p className={styles.hint}>
            Daily figures are bucketed in the society timezone and rolled up nightly. A day still in
            progress is incomplete by definition. Export is CSV rather than native .xlsx — Excel opens it
            directly, and it avoids adding a spreadsheet-writing dependency to the server.
          </p>
        </>
      )}

      {toast && (
        <div className={`${styles.toast} ${toast.type === "err" ? styles.toastErr : styles.toastOk}`}>{toast.msg}</div>
      )}
    </div>
  );
}

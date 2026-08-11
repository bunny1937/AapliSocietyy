"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import styles from "@/styles/Amenities.module.css";

const STATUS_PILL = {
  OPEN: styles.pillOpen,
  CLOSED: styles.pillClosed,
  UNDER_MAINTENANCE: styles.pillMaint,
  TEMPORARILY_CLOSED: styles.pillTemp,
  PERMANENTLY_CLOSED: styles.pillPerm,
};

function CapacityBar({ snapshot }) {
  if (!snapshot || snapshot.unlimited) {
    return <span className={styles.capText}>Unlimited</span>;
  }
  const pct = snapshot.usagePct || 0;
  const cls = pct >= 100 ? styles.capFull : snapshot.level === "WARNING" ? styles.capWarn : styles.capOk;
  return (
    <div>
      <div className={styles.capBar}>
        <div className={`${styles.capFill} ${cls}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <div className={styles.capText}>
        {snapshot.current} / {snapshot.maxOccupancy} · {pct}%
      </div>
    </div>
  );
}

export default function AmenitiesOverviewPage() {
  const [amenities, setAmenities] = useState([]);
  const [maintenance, setMaintenance] = useState([]);
  const [events, setEvents] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const today = new Date();
      const iso = (d) => d.toISOString().slice(0, 10);
      const tomorrow = new Date(today.getTime() + 86400000);

      // Four independent reads, fired together — the dashboard should not render
      // progressively as each panel arrives.
      const [aRes, mRes, eRes, iRes] = await Promise.all([
        fetch("/api/amenities?limit=100", { credentials: "include" }),
        fetch(`/api/amenities/maintenance?from=${iso(today)}&to=${iso(today)}&limit=20`, { credentials: "include" }),
        fetch(`/api/amenities/events?from=${iso(today)}&to=${iso(tomorrow)}&limit=20`, { credentials: "include" }),
        fetch("/api/amenities/incidents?status=OPEN&limit=20", { credentials: "include" }),
      ]);
      const [a, m, e, i] = await Promise.all([aRes.json(), mRes.json(), eRes.json(), iRes.json()]);
      if (aRes.ok) setAmenities(a.amenities || []);
      if (mRes.ok) setMaintenance(m.maintenance || []);
      if (eRes.ok) setEvents(e.events || []);
      if (iRes.ok) setIncidents(i.incidents || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Occupancy moves constantly; a 60s refresh keeps the panel honest without
  // hammering the API.
  useEffect(() => {
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  const occupied = amenities.filter((a) => (a.liveOccupancy || 0) > 0);
  const insideTotal = amenities.reduce((s, a) => s + (a.liveOccupancy || 0), 0);
  const closed = amenities.filter((a) => a.status !== "OPEN").length;
  const critical = incidents.filter((i) => ["HIGH", "CRITICAL"].includes(i.severity)).length;

  if (loading && !amenities.length) {
    return <div className={styles.page}><div className={styles.loading}>Loading amenities…</div></div>;
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Amenities</h1>
          <p className={styles.subtitle}>Live occupancy, today&apos;s maintenance and events, and open incidents</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/admin/amenities/list" className={styles.btn}>All amenities</Link>
          <Link href="/admin/amenities/categories" className={styles.btnPrimary + " " + styles.btn}>Categories</Link>
        </div>
      </div>

      {!amenities.length && (
        <div className={`${styles.banner} ${styles.bannerInfo}`}>
          No amenities yet. Create a category first, then add amenities to it — categories are how residents
          browse, so it is worth naming them the way your society already talks about these facilities.
        </div>
      )}

      <div className={styles.statGrid}>
        <div className={styles.stat}>
          <p className={styles.statLabel}>Amenities</p>
          <div className={styles.statValue}>{amenities.length}</div>
          <div className={styles.statHint}>{closed} not open</div>
        </div>
        <div className={styles.stat}>
          <p className={styles.statLabel}>People inside now</p>
          <div className={styles.statValue}>{insideTotal}</div>
          <div className={styles.statHint}>across {occupied.length} amenities</div>
        </div>
        <div className={styles.stat}>
          <p className={styles.statLabel}>Under maintenance today</p>
          <div className={styles.statValue}>{maintenance.length}</div>
        </div>
        <div className={styles.stat}>
          <p className={styles.statLabel}>Open incidents</p>
          <div className={styles.statValue}>{incidents.length}</div>
          <div className={styles.statHint}>{critical} high or critical</div>
        </div>
      </div>

      <div className={styles.grid2}>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Live occupancy</h2>
          {!occupied.length ? (
            <p className={styles.emptyText}>Nobody is checked in right now.</p>
          ) : (
            <table className={styles.table}>
              <tbody>
                {occupied.map((a) => (
                  <tr key={a._id}>
                    <td><span className={styles.rowName}>{a.name}</span></td>
                    <td style={{ width: 150 }}><CapacityBar snapshot={a.capacitySnapshot} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Today&apos;s events</h2>
          {!events.length ? (
            <p className={styles.emptyText}>No events scheduled today or tomorrow.</p>
          ) : (
            <table className={styles.table}>
              <tbody>
                {events.map((e) => (
                  <tr key={e._id}>
                    <td>
                      <div className={styles.rowName}>{e.title}</div>
                      <div className={styles.rowSub}>
                        {e.amenityName} · {new Date(e.startAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <span className={`${styles.pill} ${styles.pillInfo}`}>
                        {e.registeredCount || 0}{e.capacity ? ` / ${e.capacity}` : ""}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Maintenance today</h2>
          {!maintenance.length ? (
            <p className={styles.emptyText}>Nothing under maintenance today.</p>
          ) : (
            <table className={styles.table}>
              <tbody>
                {maintenance.map((m) => (
                  <tr key={m._id}>
                    <td>
                      <div className={styles.rowName}>{m.amenityName}</div>
                      <div className={styles.rowSub}>{m.reason}</div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <span className={`${styles.pill} ${styles.pillMaint}`}>{m.status.replace("_", " ")}</span>
                      {m.extensions?.length ? (
                        <div className={styles.rowSub}>extended ×{m.extensions.length}</div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Open incidents</h2>
          {!incidents.length ? (
            <p className={styles.emptyText}>No open incidents.</p>
          ) : (
            <table className={styles.table}>
              <tbody>
                {incidents.slice(0, 8).map((i) => (
                  <tr key={i._id}>
                    <td>
                      <div className={styles.rowName}>{i.title}</div>
                      <div className={styles.rowSub}>{i.amenityName} · {i.incidentType}</div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <span className={`${styles.pill} ${styles["sev" + i.severity]}`}>{i.severity}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

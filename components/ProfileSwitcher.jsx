"use client";
// components/ProfileSwitcher.jsx
//
// The in-session web equivalent of the mobile app's flat-switcher avatar
// (aaplisociety_app/lib/features/member/widgets/flat_switcher_avatar.dart).
//
// Web already had a picker for logging IN (app/auth/select-society) but
// nothing once you were inside — a person with two flats, or a flat plus an
// admin/guard hat, had to log out and back in to change context. This reads
// GET /api/auth/my-profiles and, when there is more than one profile to
// switch between, renders a menu that calls the SAME /api/auth/switch-profile
// endpoint the login-time picker uses, then reloads so every cached query
// (bills, members, dashboards — all society-scoped) is re-fetched under the
// new session rather than leaking the old society's data into the new one.
//
// Renders nothing at all when the account only has one profile, matching the
// mobile rule: "single-profile accounts get no gesture."

import { useEffect, useRef, useState } from "react";
import { ChevronsUpDown, Check } from "lucide-react";
import styles from "@/styles/ProfileSwitcher.module.css";

function profileLabel(p) {
  if (p.kind === "Staff") {
    return { title: p.role || "Staff", subtitle: p.societyName || "" };
  }
  const unit = [p.wing, p.flatNo].filter(Boolean).join("-") || (p.kind === "Commercial" ? "Shop" : "Flat");
  return { title: unit, subtitle: p.societyName || "" };
}

export default function ProfileSwitcher() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(null); // profileId being switched to
  const [error, setError] = useState(null);
  const boxRef = useRef(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/my-profiles", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (!data || !data.canSwitch) return null;

  const grouped = new Map();
  for (const p of data.profiles) {
    const key = p.societyName || "Society";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(p);
  }

  const switchTo = async (profile) => {
    setSwitching(profile.profileId);
    setError(null);
    try {
      const res = await fetch("/api/auth/switch-profile", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: profile.profileId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error || "That profile could not be switched to.");
        setSwitching(null);
        return;
      }
      // The route the profile itself names (mobile learned this the hard way —
      // see profile_select_page.dart) rather than a role guess made here.
      const staffRoute = profile.kind === "Staff" ? profile.route || "/my-access" : null;
      const dest =
        staffRoute ||
        (profile.kind === "Commercial" || profile.kind === "Residential" ? "/member/dashboard" : "/admin/dashboard");
      // A full navigation, not router.push: every cached query in this session
      // (bills, members, everything society-scoped) must be re-fetched under
      // the new cookie, not served stale from the previous society's cache.
      window.location.href = dest;
    } catch {
      setError("That profile could not be switched to. Check your connection and try again.");
      setSwitching(null);
    }
  };

  return (
    <div className={styles.wrap} ref={boxRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Switch profile"
      >
        <span className={styles.triggerLabel}>Switch profile</span>
        <ChevronsUpDown size={14} strokeWidth={1.75} />
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          {error && <div className={styles.error}>{error}</div>}
          {[...grouped.entries()].map(([societyName, profiles]) => (
            <div key={societyName} className={styles.group}>
              <div className={styles.groupLabel}>{societyName}</div>
              {profiles.map((p) => {
                const { title, subtitle } = profileLabel(p);
                const active = p.profileId === data.activeProfileId;
                return (
                  <button
                    key={p.profileId}
                    type="button"
                    className={styles.item}
                    disabled={switching !== null}
                    onClick={() => (active ? setOpen(false) : switchTo(p))}
                  >
                    <span className={styles.itemMain}>
                      <span className={styles.itemTitle}>{title}</span>
                      {p.role && p.kind !== "Staff" && (
                        <span className={styles.itemRole}>{p.role}</span>
                      )}
                    </span>
                    {active ? (
                      <Check size={14} strokeWidth={2} />
                    ) : switching === p.profileId ? (
                      <span className={styles.itemBusy}>Switching…</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

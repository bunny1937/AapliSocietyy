"use client";
/**
 * <FirstRunHint> — §7.27 of docs/accounting-module-audit-and-consolidation-
 * plan.md: lightweight contextual onboarding, shown once per feature per
 * browser (localStorage), never again after dismissed or after the admin
 * has taken the hinted action once.
 */
import { useEffect, useState } from "react";
import { Icon } from "@/components/revamp";

const KEY_PREFIX = "accounting.firstRun.";

export function hasSeenFirstRun(featureKey) {
  try { return window.localStorage.getItem(KEY_PREFIX + featureKey) === "1"; } catch { return true; }
}

export function markFirstRunSeen(featureKey) {
  try { window.localStorage.setItem(KEY_PREFIX + featureKey, "1"); } catch { /* best-effort */ }
}

export default function FirstRunHint({ featureKey, title, body, meta }) {
  const [seen, setSeen] = useState(true); // default hidden until we know, so nothing flashes
  useEffect(() => { setSeen(hasSeenFirstRun(featureKey)); }, [featureKey]);

  if (seen) return null;
  return (
    <div style={{
      display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderRadius: 10,
      background: "var(--r-brand-soft, var(--r-surface-2))", border: "1px solid var(--r-brand)", marginBottom: 14,
    }}>
      <Icon name="sparkles" size={15} color="var(--r-brand)" style={{ marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--r-fg-1)" }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "var(--r-fg-3)", marginTop: 3, lineHeight: 1.55 }}>{body}</div>
        {meta ? <div style={{ fontSize: 11, color: "var(--r-fg-4)", marginTop: 4 }}>{meta}</div> : null}
      </div>
      <button
        type="button"
        onClick={() => { markFirstRunSeen(featureKey); setSeen(true); }}
        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--r-fg-4)", fontSize: 15, lineHeight: 1, padding: 2 }}
        title="Got it, don't show again"
      >×</button>
    </div>
  );
}

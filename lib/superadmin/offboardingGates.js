// The offboarding checklist.
//
// Erasing a society is gated on six independent conditions (see
// app/api/v1/cron/society-purge/route.js). Until now the only way to know
// which of them a given society had satisfied was to read the purge cron's
// skip reason in an ops table, or query Mongo by hand — so the common
// question, "I did the handover, what happens now?", had no answer anywhere
// in the product.
//
// This turns the gates into a list you can look at: what is done, what is
// waiting, what is not applicable, and for anything outstanding, the thing to
// go and do about it.
//
// Pure: hand it a society document and its handover, get the checklist back.
// No database access, so the purge cron's rules can be shown without being
// duplicated in a component.

export const GATE_STATE = {
  DONE: "done",
  PENDING: "pending",
  BLOCKED: "blocked",
  WAIVED: "waived",
  NOT_STARTED: "not-started",
};

const HOUR = 60 * 60 * 1000;

/**
 * @param society  a Society document (lean is fine)
 * @param handover the newest SocietyHandover for it, or null
 * @param now      injectable clock
 * @returns {{ started, purgeReady, gates: [], summary: string }}
 */
export function offboardingChecklist(society, handover, now = new Date()) {
  const t = now.getTime();
  const off = society?.offboarding || {};
  const started = Boolean(society?.isDeleted);

  const killSwitchOff = process.env.SOCIETY_PURGE_ENABLED === "false";

  const gates = [];

  // ── 1. platform kill switch ──
  gates.push({
    id: "kill-switch",
    title: "Platform purge is enabled",
    detail: killSwitchOff
      ? "SOCIETY_PURGE_ENABLED is set to \"false\", so no society is being erased anywhere on the platform."
      : "The platform-wide brake is off, so purges can run.",
    state: killSwitchOff ? GATE_STATE.BLOCKED : GATE_STATE.DONE,
    action: killSwitchOff ? { label: "Check platform settings", href: "/superadmin/settings" } : null,
  });

  // ── 2. soft-deleted ──
  gates.push({
    id: "soft-deleted",
    title: "Society is soft-deleted",
    detail: started
      ? `Marked for deletion on ${fmt(society.deletedAt)}.`
      : "This society is live. Nothing will ever be erased until somebody starts the delete flow — a handover on its own does not schedule anything.",
    state: started ? GATE_STATE.DONE : GATE_STATE.NOT_STARTED,
    action: started ? null : { label: "Open delete flow", href: "/superadmin/societies" },
  });

  // ── 3. the grace date has arrived ──
  const scheduled = society?.purgeScheduledFor ? new Date(society.purgeScheduledFor) : null;
  const dateArrived = scheduled ? scheduled.getTime() <= t : false;
  gates.push({
    id: "grace-elapsed",
    title: "Grace period has elapsed",
    detail: !started
      ? "Set when the society is soft-deleted."
      : !scheduled
        ? "No erase date is set, so the purge has nothing to compare against."
        : dateArrived
          ? `The erase date (${fmt(scheduled)}) has passed.`
          : `Scheduled for ${fmt(scheduled)} — ${daysBetween(t, scheduled.getTime())} to go.`,
    state: !started
      ? GATE_STATE.NOT_STARTED
      : dateArrived
        ? GATE_STATE.DONE
        : GATE_STATE.PENDING,
    meta: scheduled ? { date: scheduled } : null,
  });

  // ── 4. we took an export AND verified it ──
  const verifiedAt = off.exportVerifiedAt ? new Date(off.exportVerifiedAt) : null;
  gates.push({
    id: "export-verified",
    title: "Our export was taken and verified",
    detail: verifiedAt
      ? `Verified against live data on ${fmt(verifiedAt)}.`
      : "Proves WE hold a good copy before anything is destroyed. Without it the erase date is just a date.",
    state: verifiedAt ? GATE_STATE.DONE : started ? GATE_STATE.PENDING : GATE_STATE.NOT_STARTED,
    action: verifiedAt ? null : { label: "Export & verify", href: "/superadmin/exports" },
  });

  // ── 5. no same-minute race ──
  const deletedAt = society?.deletedAt ? new Date(society.deletedAt) : null;
  const settled = deletedAt ? t - deletedAt.getTime() >= HOUR : false;
  gates.push({
    id: "settled",
    title: "Deletion has settled for an hour",
    detail: !deletedAt
      ? "Starts once the society is soft-deleted."
      : settled
        ? "Past the one-hour cooling-off window."
        : "Within the first hour of deletion — a deliberate pause against a mistaken click.",
    state: !deletedAt ? GATE_STATE.NOT_STARTED : settled ? GATE_STATE.DONE : GATE_STATE.PENDING,
  });

  // ── 6. the society has its own copy ──
  const waivedAt = off.handoverWaivedAt ? new Date(off.handoverWaivedAt) : null;
  const collectedAt = handover?.confirmedAt || handover?.downloadedAt || null;
  const collected = Boolean(collectedAt);
  gates.push({
    id: "handover-collected",
    title: "Society collected its records",
    detail: waivedAt
      ? `Waived on ${fmt(waivedAt)}${off.handoverWaivedBy ? ` by ${off.handoverWaivedBy}` : ""}.`
      : collected
        ? handover.confirmedAt
          ? `Downloaded and confirmed on ${fmt(handover.confirmedAt)}.`
          : `Downloaded on ${fmt(handover.downloadedAt)}, not yet confirmed.`
        : handover
          ? `Sent ${fmt(handover.notifiedAt)} to ${(handover.recipients || []).join(", ") || "nobody"} — not collected. ${handover.reminderCount || 0} reminder(s) sent.`
          : "No handover has been prepared for this society.",
    state: waivedAt
      ? GATE_STATE.WAIVED
      : collected
        ? GATE_STATE.DONE
        : handover
          ? GATE_STATE.PENDING
          : GATE_STATE.NOT_STARTED,
    action: collected || waivedAt ? null : { label: "Prepare handover", href: "/superadmin/societies" },
  });

  const blocking = gates.filter(
    (g) => g.state === GATE_STATE.PENDING || g.state === GATE_STATE.BLOCKED || g.state === GATE_STATE.NOT_STARTED,
  );
  const purgeReady = blocking.length === 0;

  return {
    started,
    purgeReady,
    gates,
    // Drift is reported, never a gate: the recipient does hold a complete copy
    // of the society as it stood when the export was built. Refusing custody
    // because a bill was paid since would make the gate unsatisfiable.
    drift: handover?.driftMismatchCount ?? null,
    summary: !started
      ? "This society is live. Nothing is scheduled and nothing will be erased."
      : purgeReady
        ? "Every gate is satisfied. The next purge run will erase this society."
        : `${blocking.length} of 6 still outstanding: ${blocking.map((g) => g.title.toLowerCase()).join(", ")}.`,
  };
}

function fmt(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function daysBetween(from, to) {
  const days = Math.ceil((to - from) / (24 * HOUR));
  if (days <= 0) return "due";
  return days === 1 ? "1 day" : `${days} days`;
}

import AuditLog from "@/models/AuditLog";

// Lifecycle audit trail for a society: paused, exported, verified,
// soft-deleted, restored, purged.
//
// ## Why societyId is deliberately left null
//
// AuditLog is itself a society-scoped collection in SOCIETY_COLLECTIONS, so
// purgeSociety deletes every AuditLog row carrying this societyId. If the
// offboarding trail were written the normal way, the purge would erase its own
// evidence — the one record Rule 6 most wants kept, gone at exactly the moment
// it starts to matter.
//
// So these rows are written with societyId: null (the field is optional by
// design, for pre-auth events) and the society's identity lives in newData
// instead. They survive the purge; ordinary member-level audit rows still get
// erased with everything else, which is what erasure requires.
export const SOCIETY_LIFECYCLE_ACTIONS = {
  PAUSED: "SOCIETY_PAUSED",
  RESUMED: "SOCIETY_RESUMED",
  EXPORT_DOWNLOADED: "SOCIETY_EXPORT_DOWNLOADED",
  EXPORT_VERIFIED: "SOCIETY_EXPORT_VERIFIED",
  SOFT_DELETED: "SOCIETY_SOFT_DELETED",
  RESTORED: "SOCIETY_RESTORED",
  PURGED: "SOCIETY_PURGED",
  QUICK_DELETED: "SOCIETY_QUICK_DELETED",
  // Phase 3/4: the society's own copy of its records — built and emailed,
  // collected by them, and confirmed byte-for-byte from their browser.
  HANDOVER_SENT: "SOCIETY_HANDOVER_SENT",
  HANDOVER_DOWNLOADED: "SOCIETY_HANDOVER_DOWNLOADED",
  HANDOVER_CONFIRMED: "SOCIETY_HANDOVER_CONFIRMED",
  HANDOVER_REMINDED: "SOCIETY_HANDOVER_REMINDED",
  // Platform-wide, not society-scoped. Written with societyId null so a purge
  // can never erase the record of a settings change.
  PLATFORM_SETTING_CHANGED: "PLATFORM_SETTING_CHANGED",
};

/**
 * @param action        one of SOCIETY_LIFECYCLE_ACTIONS
 * @param societyId     the society acted on
 * @param societyName   captured now — after a purge there is nothing to join to
 * @param actorUserId   who did it ("Cron" for scheduled purges)
 * @param details       action-specific payload (counts, purge date, format, …)
 */
export async function logSocietyLifecycle({ action, societyId, societyName, actorUserId, details = {} }) {
  try {
    await AuditLog.create({
      userId: actorUserId || null,
      societyId: null, // intentional — see note above
      action,
      newData: {
        societyId: String(societyId),
        societyName: societyName || null,
        actor: actorUserId ? String(actorUserId) : "Cron",
        ...details,
      },
      timestamp: new Date(),
    });
  } catch (err) {
    // Never let an audit write failure abort the operation it describes — a
    // half-purged society is worse than a missing log line.
    console.error("society lifecycle audit error:", err);
  }
}

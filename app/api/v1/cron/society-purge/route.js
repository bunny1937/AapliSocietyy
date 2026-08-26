import { withRoute, json } from "@/lib/v1/http";
import { cronAuthorized } from "@/lib/v1/config";
import connectDB from "@/lib/mongodb";
import { setting } from "@/lib/platform/settings";
import { ensureSettings } from "@/lib/platform/settingsStore";
import Society from "@/models/Society";
import SocietyHandover from "@/models/SocietyHandover";
import { purgeSociety } from "@/lib/superadmin/societyPurge";
import { logSocietyLifecycle, SOCIETY_LIFECYCLE_ACTIONS } from "@/lib/superadmin/societyAudit";
import { withCronRun } from "@/lib/ops/cronTracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// A society soft-deleted less than this ago is never purged, no matter what
// date was picked — protects against a same-minute misclick and gives a
// deliberate floor for "restore me, I just did that by mistake".
const MIN_AGE_AFTER_SOFT_DELETE_MS = 60 * 60 * 1000; // 1 hour
const MAX_SOCIETIES_PER_RUN = 5;

/**
 * GET /v1/cron/society-purge
 *
 * cron-job.org, daily 04:00 IST (after retention-scan and retention-purge):
 *   https://aaplisociety.vercel.app/v1/cron/society-purge
 *   Header: Authorization: Bearer <CRON_SECRET>
 *
 * ## What this fixes
 *
 * `purgeScheduledFor` was written by the delete wizard's "Delete until date"
 * and then read by nothing at all. The soft delete was permanent by inaction:
 * the society stayed blocked forever, its data stayed on our disks forever,
 * and the purge the admin was promised never happened. That is the worst of
 * both worlds — the society can't use their data and we're still holding it.
 *
 * ## The gate
 *
 * A society is purged only when ALL SIX hold. Any one failing skips it
 * entirely and it is retried tomorrow.
 *
 *   1. SOCIETY_PURGE_ENABLED is not "false"      — platform kill switch
 *   2. isDeleted === true                         — soft-deleted, not merely paused
 *   3. purgeScheduledFor <= now                   — the date has actually arrived
 *   4. offboarding.exportVerifiedAt is set        — a human took an export AND
 *                                                   verified it against live state
 *   5. deletedAt is at least 1 hour old           — no same-minute races
 *   6. the society collected its handover         — downloaded or confirmed,
 *                                                   or a recorded waiver
 *
 * Gate 6 is the one that makes this a handover rather than a deletion. Gate 4
 * proves *we* took a copy and checked it; only gate 6 proves the *society* has
 * one. It gates on downloadedAt, never on notifiedAt — a dispatched email says
 * nothing about whether a human received anything, the same judgement
 * retention-purge already makes.
 *
 * Its deadlock is answered by /v1/cron/society-handover-reminder, which chases
 * uncollected handovers weekly; and its genuinely-unreachable case (a
 * dissolved committee, a dead address) by offboarding.handoverWaivedAt, which
 * records the decision and who made it instead of quietly bypassing the gate.
 *
 * Gate 4 is the other important one. Without it `purgeScheduledFor` is an
 * unattended timer, and a mistyped date silently destroys a live society with
 * nobody having ever taken a copy. With it, the worst case of a mistyped date
 * is that nothing happens.
 *
 * The consequence is deliberate, and matches retention-purge's judgement:
 * **if the export was never verified, nothing is ever deleted.** Soft-deleted
 * societies pile up as pending. Unbounded retention is a far better failure
 * mode than silent data loss — and it is visible, which silent loss is not.
 *
 * `?dryRun=1` reports what would happen and deletes nothing.
 */
export const GET = withRoute(async (req) => {
  if (!cronAuthorized(req)) return json({ error: "Unauthorized" }, { status: 401 });
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  return json(await withCronRun("society-purge", (ctx) => runSocietyPurge(ctx.req))({ dryRun, req }));
});

async function runSocietyPurge(req) {

  await connectDB();
  await ensureSettings();
  const startedAt = Date.now();
  const url = new URL(req.url);

  // Gate 1 — platform kill switch. Explicitly "false" disables purging
  // everywhere, immediately. A brake, not an accelerator: setting it to true
  // enables nothing on its own.
  // Settings page or env var; see lib/platform/settings.js.
  const killSwitchOff = setting("SOCIETY_PURGE_ENABLED") === false;
  const dryRun = url.searchParams.get("dryRun") === "1" || killSwitchOff;

  const now = new Date();

  // Gates 2, 3 and 5 in the query; gate 4 is checked per-society below so the
  // skip reason can be reported rather than silently filtered out.
  const candidates = await Society.find({
    isDeleted: true,
    purgeScheduledFor: { $ne: null, $lte: now },
    deletedAt: { $lt: new Date(Date.now() - MIN_AGE_AFTER_SOFT_DELETE_MS) },
  })
    .sort({ purgeScheduledFor: 1 })
    .limit(MAX_SOCIETIES_PER_RUN)
    .select("name societyId deletedAt purgeScheduledFor offboarding")
    .lean();

  const results = [];

  for (const society of candidates) {
    const id = String(society._id);
    const base = {
      societyId: id,
      societyName: society.name,
      purgeScheduledFor: society.purgeScheduledFor,
    };

    // Gate 4 — proof a human took a copy and checked it. Never purge on a
    // date alone.
    if (!society.offboarding?.exportVerifiedAt) {
      results.push({ ...base, action: "skipped", reason: "export was never verified" });
      continue;
    }

    // Gate 6 — proof the SOCIETY has its records, not just that we offered.
    const handover = await SocietyHandover.findOne({
      societyId: id,
      status: { $in: ["downloaded", "confirmed"] },
    })
      .select("downloadedAt confirmedAt status")
      .lean();
    const waived = society.offboarding?.handoverWaivedAt;
    if (!handover && !waived) {
      const pending = await SocietyHandover.findOne({ societyId: id })
        .sort({ createdAt: -1 })
        .select("status notifiedAt reminderCount")
        .lean();
      results.push({
        ...base,
        action: "skipped",
        reason: pending
          ? `handover not collected (status: ${pending.status}, reminders sent: ${pending.reminderCount || 0})`
          : "no handover was ever built for this society",
      });
      continue;
    }

    if (dryRun) {
      results.push({
        ...base,
        action: "would-purge",
        reason: killSwitchOff ? "SOCIETY_PURGE_ENABLED=false" : "dryRun=1",
        exportVerifiedAt: society.offboarding.exportVerifiedAt,
        handoverCollectedAt: handover?.confirmedAt || handover?.downloadedAt || null,
        handoverWaivedAt: waived || null,
      });
      continue;
    }

    try {
      const deleted = await purgeSociety(id);
      await logSocietyLifecycle({
        action: SOCIETY_LIFECYCLE_ACTIONS.PURGED,
        societyId: id,
        societyName: society.name,
        actorUserId: null, // "Cron"
        details: {
          trigger: "scheduled",
          purgeScheduledFor: society.purgeScheduledFor,
          exportVerifiedAt: society.offboarding.exportVerifiedAt,
          verifiedCounts: society.offboarding.verifiedCounts || null,
          handoverStatus: handover?.status || null,
          handoverCollectedAt: handover?.confirmedAt || handover?.downloadedAt || null,
          handoverWaivedAt: waived || null,
          handoverWaivedReason: society.offboarding?.handoverWaivedReason || null,
          deleted,
        },
      });
      results.push({ ...base, action: "purged", deleted });
    } catch (err) {
      console.error(`society-purge: ${id} —`, err);
      results.push({ ...base, action: "failed", reason: err.message });
    }
  }

  return {
    ok: true,
    dryRun,
    killSwitchOff,
    checked: candidates.length,
    purged: results.filter((r) => r.action === "purged").length,
    skipped: results.filter((r) => r.action === "skipped").length,
    failed: results.filter((r) => r.action === "failed").length,
    results,
    tookMs: Date.now() - startedAt,
  };
}

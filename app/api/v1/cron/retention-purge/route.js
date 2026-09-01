import { withRoute, json } from "@/lib/v1/http";
import { cronAuthorized } from "@/lib/v1/config";
import mongoose from "mongoose";
import Society from "@/models/Society";
import RetentionArchive from "@/models/RetentionArchive";
import RetentionSetting from "@/models/RetentionSetting";
import { policyById, RETENTION_POLICIES } from "@/lib/retention/policies";
import { purgeExpiredTenancyDocuments } from "@/lib/tenancy/purgeExpiredDocuments";
import { withCronRun } from "@/lib/ops/cronTracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /v1/cron/retention-purge
 *
 * cron-job.org, daily 03:30 IST (an hour after the scan):
 *   https://aaplisociety.vercel.app/v1/cron/retention-purge
 *   Header: Authorization: Bearer <CRON_SECRET>
 *
 * ## The gate
 *
 * A document is deleted only when ALL SIX of these hold. Any one failing skips
 * the archive entirely and it is retried tomorrow.
 *
 *   1. RETENTION_PURGE_ENABLED is not "false"      — platform kill switch
 *   2. The society has `enabled: true`              — per-society opt-in
 *   3. The society opted in to THIS policy          — per-class opt-in
 *   4. The policy is `purgeable`                    — code-level veto
 *   5. archive.status === "downloaded"              — a human took a copy
 *   6. archive.downloadedAt is at least 1 hour old  — no same-minute races
 *
 * Note what is NOT in that list: "we sent an email". The old design purged
 * once an email had been *dispatched*, which proves nothing — the address
 * could be stale, the mail could bounce, it could sit in spam. Gating on
 * `downloadedAt` means the bytes provably reached a logged-in human before the
 * original was removed.
 *
 * The consequence is deliberate: **if nobody ever downloads, nothing is ever
 * deleted.** The archives pile up as pending and the admin keeps getting
 * reminders. Unbounded growth is a far better failure mode than silent data
 * loss.
 *
 * ## Deletion is by pinned id, never by re-running the query
 *
 * We delete exactly `archive.docIds` — the set that was frozen at scan time
 * and that the admin actually received. Re-running "older than 60 days" at
 * purge time would match rows created after the scan, which the admin has
 * never seen a copy of.
 */

const MIN_AGE_AFTER_DOWNLOAD_MS = 60 * 60 * 1000;
const MAX_ARCHIVES_PER_RUN = 50;

async function loadModel(policy) {
  const guessName = policy.modelPath.split("/").pop();
  if (mongoose.models[guessName]) return mongoose.models[guessName];
  try {
    const mod = await import(`${policy.modelPath}`);
    return mod.default;
  } catch {
    return null;
  }
}

export const GET = withRoute(async (req) => {
  if (!cronAuthorized(req)) return json({ error: "Unauthorized" }, { status: 401 });
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  return json(await withCronRun("retention-purge", (ctx) => runRetentionPurge(ctx.req))({ dryRun, req }));
});

async function runRetentionPurge(req) {

  const startedAt = Date.now();
  const url = new URL(req.url);

  // Gate 1 — platform kill switch. Explicitly "false" disables everything,
  // everywhere, immediately. It is a brake, not an accelerator: setting it to
  // true enables nothing on its own.
  const killSwitchOff = process.env.RETENTION_PURGE_ENABLED === "false";
  // Independently, a run can be forced into report-only mode from the URL.
  const dryRun = url.searchParams.get("dryRun") === "1" || killSwitchOff;

  const candidates = await RetentionArchive.find({
    status: "downloaded",
    downloadedAt: { $lt: new Date(Date.now() - MIN_AGE_AFTER_DOWNLOAD_MS) },
  })
    .sort({ downloadedAt: 1 })
    .limit(MAX_ARCHIVES_PER_RUN)
    .lean();

  const results = [];
  const perSocietyDeleted = new Map();

  // RetentionArchive.societyId is an ObjectId; RetentionSetting is keyed by
  // the society's human code (its societyId field is a String). Passing the
  // ObjectId to resolve() finds nothing, and "nothing" reads as "this society
  // has not opted in" — so every purge was silently skipped even where a
  // society HAD enabled deletion. Fail-safe, but never what was configured.
  const settingsKeyCache = new Map();
  const settingsKeyFor = async (societyObjectId) => {
    const cacheKey = String(societyObjectId);
    if (settingsKeyCache.has(cacheKey)) return settingsKeyCache.get(cacheKey);
    const society = await Society.findById(societyObjectId)
      .select("societyId")
      .lean();
    const key = society?.societyId || cacheKey;
    settingsKeyCache.set(cacheKey, key);
    return key;
  };

  for (const archive of candidates) {
    const policy = policyById(archive.policyId);
    const skip = (reason) =>
      results.push({
        archiveId: String(archive._id),
        societyId: archive.societyId,
        policyId: archive.policyId,
        recordCount: archive.recordCount,
        action: "skipped",
        reason,
      });

    // Gate 4 — code-level veto. Complaints and payment imports can never be
    // auto-deleted regardless of any setting a society or operator applies.
    if (!policy) { skip("unknown policy"); continue; }
    if (!policy.purgeable) { skip("policy is archive-only (purgeable: false)"); continue; }

    // Gates 2 and 3 — per-society and per-class opt-in.
    const setting = await RetentionSetting.resolve(
      await settingsKeyFor(archive.societyId),
      policy,
    );
    if (!setting.societyEnabled) { skip("society has not enabled retention"); continue; }
    if (!setting.purgeEnabled) { skip(`society has not enabled deletion for ${policy.id}`); continue; }

    // Per-society nightly ceiling. A misconfiguration costs a slow catch-up,
    // not a data loss event.
    const already = perSocietyDeleted.get(archive.societyId) ?? 0;
    if (already >= setting.maxPurgePerNight) { skip("society nightly purge cap reached"); continue; }

    // Integrity check: the pinned list must still match the recorded count.
    if (!Array.isArray(archive.docIds) || archive.docIds.length !== archive.recordCount) {
      skip("docIds/recordCount mismatch — archive is not trustworthy");
      continue;
    }

    const remaining = setting.maxPurgePerNight - already;
    const idsToDelete = archive.docIds.slice(0, remaining);

    if (dryRun) {
      results.push({
        archiveId: String(archive._id),
        societyId: archive.societyId,
        policyId: archive.policyId,
        recordCount: archive.recordCount,
        action: "would-delete",
        wouldDelete: idsToDelete.length,
        reason: killSwitchOff ? "RETENTION_PURGE_ENABLED=false" : "dryRun=1",
      });
      continue;
    }

    const Model = await loadModel(policy);
    if (!Model) { skip("model could not be loaded"); continue; }

    const res = await Model.deleteMany({ _id: { $in: idsToDelete } });
    const deleted = res.deletedCount ?? 0;
    perSocietyDeleted.set(archive.societyId, already + deleted);

    const fullyDone = idsToDelete.length === archive.docIds.length;
    await RetentionArchive.updateOne(
      { _id: archive._id },
      {
        $set: {
          status: fullyDone ? "purged" : "downloaded",
          purgedAt: new Date(),
          // Keep the remainder pinned for tomorrow if we hit the cap.
          ...(fullyDone ? {} : { docIds: archive.docIds.slice(remaining) }),
        },
        $inc: { purgedCount: deleted },
      },
    );
    await RetentionSetting.updateOne(
      { societyId: archive.societyId },
      { $set: { lastPurgeAt: new Date() } },
      { upsert: true },
    );

    results.push({
      archiveId: String(archive._id),
      societyId: archive.societyId,
      policyId: archive.policyId,
      action: "purged",
      deleted,
      remaining: fullyDone ? 0 : archive.docIds.length - remaining,
    });
  }

  // Visibility: archives waiting on a human. If this number climbs steadily,
  // an admin somewhere is ignoring their email — which is safe, but you want
  // to know.
  const awaitingDownload = await RetentionArchive.countDocuments({ status: "pending" });

  // Tenancy documents whose retention has run out. Folded in here rather than
  // given its own cron: a retention rule with no runner is not a rule, and a
  // third external schedule is a third thing to forget to register. Same job,
  // same night, same purpose — delete what we said we would delete. Honours
  // the same dry-run and kill-switch as everything above.
  const tenancyDocuments = await purgeExpiredTenancyDocuments({ dryRun });

  return {
    ok: true,
    mode: dryRun ? (killSwitchOff ? "disabled-by-kill-switch" : "dry-run") : "live",
    archivesConsidered: candidates.length,
    purged: results.filter((r) => r.action === "purged").length,
    skipped: results.filter((r) => r.action === "skipped").length,
    totalDeleted: results.reduce((s, r) => s + (r.deleted ?? 0), 0),
    awaitingDownload,
    tenancyDocuments,
    archiveOnlyPolicies: RETENTION_POLICIES.filter((p) => !p.purgeable).map((p) => p.id),
    results,
    tookMs: Date.now() - startedAt,
  };
}

import { withRoute, json } from "@/lib/v1/http";
import { cronAuthorized } from "@/lib/v1/config";
import mongoose from "mongoose";
import Society from "@/models/Society";
import RetentionArchive from "@/models/RetentionArchive";
import RetentionSetting from "@/models/RetentionSetting";
import { RETENTION_POLICIES, istRunDate } from "@/lib/retention/policies";
import {
  retentionRecipients,
  retentionEmailHtml,
  sendRetentionEmails,
} from "@/lib/retention/notifyAdmin";
import { withCronRun } from "@/lib/ops/cronTracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /v1/cron/retention-scan
 *
 * Replaces the old `retention-export` route. Delete that file.
 *
 * cron-job.org, daily 02:30 IST:
 *   https://aaplisociety.vercel.app/v1/cron/retention-scan
 *   Header: Authorization: Bearer <CRON_SECRET>
 *
 * ## This job cannot delete anything and does not build any files
 *
 * All it does is COUNT and PIN. For each society × policy it finds the
 * documents that have aged past the archive threshold, records their exact
 * `_id`s in a RetentionArchive, and emails the admin that a download is
 * waiting. It writes nothing to R2, generates no spreadsheets, and touches no
 * source data other than reading it.
 *
 * The expensive part — building XLSX/PDF/DOCX/CSV/JSON — happens only if and
 * when a human actually clicks download. For the many societies where nobody
 * ever does, the cost of this whole system is one indexed count query a night.
 *
 * ## Why it scans societies that have retention disabled
 *
 * Because "you have 12,400 old notifications sitting there" is useful
 * information even to a society that never wants automatic deletion. The scan
 * is read-only; the setting only governs whether the purge job may later act.
 * Disabled societies get an archive marked purgeEnabled:false and an email
 * that says so explicitly.
 */

// Hard ceiling on ids pinned per archive. An archive of half a million
// notifications would produce a document too large for Mongo and a download
// nobody could open. Above this we take the oldest N and the rest roll into
// tomorrow's run.
const MAX_IDS_PER_ARCHIVE = 25000;

async function loadModel(policy) {
  // Models are registered by side effect of import. Using the already-
  // registered model avoids re-compiling a schema per invocation.
  const guessName = policy.modelPath.split("/").pop();
  if (mongoose.models[guessName]) return mongoose.models[guessName];
  try {
    const mod = await import(/* webpackIgnore: false */ `${policy.modelPath}`);
    return mod.default;
  } catch {
    return null;
  }
}

export const GET = withRoute(async (req) => {
  if (!cronAuthorized(req)) return json({ error: "Unauthorized" }, { status: 401 });
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  return json(await withCronRun("retention-scan", (ctx) => runRetentionScan(ctx.req))({ dryRun, req }));
});

async function runRetentionScan(req) {

  const startedAt = Date.now();
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const onlySociety = url.searchParams.get("societyId");
  const runDate = istRunDate();

  const societyFilter = { isDeleted: { $ne: true } };
  if (onlySociety) societyFilter.societyId = onlySociety;

  const societies = await Society.find(societyFilter)
    .select("_id societyId societyName adminEmail contactEmail email")
    .lean();

  const summary = [];

  for (const society of societies) {
    // TWO different identifiers, and mixing them up is what made this job
    // throw "Cast to ObjectId failed for value \"guru_soci_2026_19\"" on
    // every run. Society carries a human code in its `societyId` STRING
    // field (green_valley_andheri_2018_47) alongside the Mongo `_id`:
    //   - RetentionSetting is keyed by the code (its societyId is a String)
    //   - every content model and RetentionArchive key on the ObjectId
    const settingsKey = society.societyId || String(society._id);
    const sid = society._id;
    const pending = [];

    for (const policy of RETENTION_POLICIES) {
      const setting = await RetentionSetting.resolve(settingsKey, policy);
      const Model = await loadModel(policy);
      if (!Model) continue;

      // EmailOutbox has no societyId at all, so a per-society scan can only
      // ever match nothing. It carries its own TTL index on purgeAt, which
      // is what actually expires those rows.
      if (!Model.schema.path("societyId")) continue;

      const cutoff = new Date(
        Date.now() - setting.archiveAfterDays * 24 * 60 * 60 * 1000,
      );

      // Only rows not already pinned by an earlier archive. Without this,
      // every night would re-offer the same records until they were finally
      // purged — and for a non-purgeable policy, forever.
      const query = {
        societyId: sid,
        [policy.expiryField]: { $lt: cutoff },
        retentionArchivedAt: { $in: [null, undefined] },
      };

      const docs = await Model.find(query)
        .select("_id")
        .sort({ [policy.expiryField]: 1 })
        .limit(MAX_IDS_PER_ARCHIVE)
        .lean();

      if (!docs.length) continue;

      const docIds = docs.map((d) => d._id);

      if (dryRun) {
        pending.push({
          policyId: policy.id,
          policyLabel: policy.label,
          recordCount: docIds.length,
          purgeEnabled: setting.purgeEnabled,
          archiveId: null,
        });
        continue;
      }

      // Idempotent on (policyId, societyId, runDate) — a cron-job.org retry
      // after a timeout updates the same archive instead of making a second.
      const archive = await RetentionArchive.findOneAndUpdate(
        { policyId: policy.id, societyId: sid, runDate },
        {
          $set: {
            policyLabel: policy.label,
            societyName: society.societyName,
            cutoff,
            docIds,
            recordCount: docIds.length,
            status: "pending",
            error: null,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      // Mark the source rows as pinned so tomorrow's scan skips them. This is
      // a flag, not a deletion — the data is untouched and still fully visible
      // in the app.
      await Model.updateMany(
        { _id: { $in: docIds } },
        { $set: { retentionArchivedAt: new Date(), retentionArchiveId: archive._id } },
      );

      pending.push({
        policyId: policy.id,
        policyLabel: policy.label,
        recordCount: docIds.length,
        purgeEnabled: setting.purgeEnabled,
        archiveId: String(archive._id),
      });
    }

    if (!pending.length) continue;

    let notified = { sent: 0, failed: [] };
    if (!dryRun) {
      const settingDoc =
        await RetentionSetting.findOne({ societyId: settingsKey }).lean();
      const recipients = retentionRecipients(society, settingDoc);
      if (recipients.length) {
        const total = pending.reduce((s, p) => s + p.recordCount, 0);
        notified = await sendRetentionEmails({
          recipients,
          subject: `${society.societyName}: ${total.toLocaleString("en-IN")} records ready to archive`,
          html: retentionEmailHtml({
            societyName: society.societyName,
            runDate,
            items: pending,
            graceDays: settingDoc?.downloadGraceDays ?? 30,
          }),
        });
        await RetentionArchive.updateMany(
          { societyId: sid, runDate, status: "pending" },
          {
            $set: {
              notifiedAt: new Date(),
              notifyError: notified.failed.length
                ? JSON.stringify(notified.failed).slice(0, 500)
                : null,
            },
            $inc: { notifyCount: 1 },
          },
        );
      }
      await RetentionSetting.updateOne(
        { societyId: settingsKey },
        { $set: { lastScanAt: new Date() } },
        { upsert: true },
      );
    }

    summary.push({
      societyId: settingsKey,
      societyName: society.societyName,
      pending,
      emailsSent: notified.sent,
      emailsFailed: notified.failed.length,
    });
  }

  return {
    ok: true,
    mode: dryRun ? "dry-run" : "live",
    runDate,
    societiesScanned: societies.length,
    societiesWithPending: summary.length,
    totalRecordsPinned: summary.reduce(
      (s, x) => s + x.pending.reduce((a, p) => a + p.recordCount, 0),
      0,
    ),
    // Nothing was deleted. This job structurally cannot delete.
    recordsDeleted: 0,
    summary,
    tookMs: Date.now() - startedAt,
  };
}

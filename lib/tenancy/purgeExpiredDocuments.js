import TenantRequest from "@/models/TenantRequest";
import { deleteObject } from "@/lib/v1/storage";

// Deletes tenancy documents whose retention has run out.
//
// ## Why this is not its own cron
//
// It is a step inside /v1/cron/retention-purge rather than a route of its own,
// deliberately. A retention rule with no runner is not a retention rule — it
// is a field nobody reads, which is exactly the bug `purgeScheduledFor` was
// (written by the delete wizard, read by nothing, so the promised purge never
// happened). Adding a third cron would have meant a third thing to register
// externally and a third thing to forget; hanging it off a job that already
// runs daily and is already registered means it works the moment this deploys.
//
// The two jobs also want the same thing at the same time — it is the nightly
// "delete what we said we would delete" pass — so they belong together.
//
// ## Ordering
//
// Object first, pointer second. If the object delete fails the pointer
// survives and the row is retried tomorrow; the reverse would orphan the file
// in storage with nothing left in the database pointing at it.

const MAX_PER_RUN = 200;

/**
 * @param dryRun report without deleting
 * @returns { considered, documentsDeleted, requestsCleared, failed, results }
 */
export async function purgeExpiredTenancyDocuments({ dryRun = false } = {}) {
  const due = await TenantRequest.find({
    documentsExpireAt: { $ne: null, $lte: new Date() },
    documentsPurgedAt: null,
  })
    .sort({ documentsExpireAt: 1 })
    .limit(MAX_PER_RUN)
    .select("societyId tenantName documents documentsExpireAt")
    .lean();

  const summary = {
    considered: due.length,
    documentsDeleted: 0,
    requestsCleared: 0,
    failed: 0,
    results: [],
  };

  for (const request of due) {
    const keys = [
      request.documents?.contractKey,
      request.documents?.policeVerificationKey,
      // Legacy fields. Nothing writes these any more, but rows predating D1
      // still carry them and this is the pass that finally clears them.
      request.documents?.signatureKey,
      request.documents?.aadhaarKey,
    ].filter(Boolean);

    if (dryRun) {
      summary.results.push({
        requestId: String(request._id),
        societyId: String(request.societyId),
        wouldDelete: keys.length,
        expiredAt: request.documentsExpireAt,
      });
      continue;
    }

    const failures = [];
    for (const key of keys) {
      try {
        await deleteObject(key);
        summary.documentsDeleted++;
      } catch (err) {
        failures.push({ key, error: err.message });
      }
    }

    if (failures.length) {
      // Pointers left intact on purpose so this row comes back tomorrow.
      summary.failed++;
      summary.results.push({ requestId: String(request._id), failures });
      continue;
    }

    await TenantRequest.updateOne(
      { _id: request._id },
      {
        $unset: {
          "documents.contractKey": "",
          "documents.policeVerificationKey": "",
          "documents.signatureKey": "",
          "documents.aadhaarKey": "",
        },
        // The record of the tenancy itself stays — dates, rent, who lived
        // there. That is the society's own book, and erasing it would rewrite
        // its history. Only the scanned documents go.
        $set: { documentsPurgedAt: new Date() },
      },
    );
    summary.requestsCleared++;
    summary.results.push({
      requestId: String(request._id),
      societyId: String(request.societyId),
      deleted: keys.length,
    });
  }

  return summary;
}

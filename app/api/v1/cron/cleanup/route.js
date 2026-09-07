import { withRoute, json } from "@/lib/v1/http";
import { cronAuthorized } from "@/lib/v1/config";
import { Notification, NOTIFICATION_TTL_MS } from "@/lib/v1/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /v1/cron/cleanup - retention sweeper.
//
// Call this once a day from cron-jobs.org (Vercel Hobby only allows 2 crons/day
// and they cannot be finer than daily, which is why you set up an external one):
//
//   URL:    https://aaplisociety.visync.in/v1/cron/cleanup
//   Method: GET
//   Header: Authorization: Bearer <CRON_SECRET>
//   When:   once a day, ~03:30 IST (pick a time nobody is using the app)
//
// ## Why this exists when the TTL index already deletes notifications
//
// Belt and braces, for three specific reasons:
//
//  1. The TTL index only applies to documents that actually HAVE `expiresAt`.
//     Every notification written before the schema change has no such field, so
//     the TTL monitor will never touch it. This route backfills them.
//  2. TTL indexes do not exist on M0/M2 free-tier clusters in every region and
//     can be silently dropped by a restore from a dump taken before the index
//     was added. A cron that reports numbers means you find out.
//  3. It gives you one place to add future retention jobs, and it returns a
//     count so the cron service's success/failure log is actually informative.
//
// Deliberately capped per run: a `deleteMany` over hundreds of thousands of rows
// can run long enough to hit the serverless timeout mid-operation. Deleting in
// bounded batches is idempotent and safe to retry - the next run picks up where
// this one stopped.
const MAX_DELETES_PER_RUN = 20000;

export const GET = withRoute(async (req) => {
  if (!cronAuthorized(req)) return json({ error: "Unauthorized" }, { status: 401 });

  const startedAt = Date.now();
  const cutoff = new Date(Date.now() - NOTIFICATION_TTL_MS);

  // 1. Backfill `expiresAt` on legacy rows so the TTL index takes over from here.
  //    Anything already older than the retention window gets an expiry in the
  //    past, which the TTL monitor removes on its next sweep (within ~60s).
  const backfill = await Notification.updateMany(
    { expiresAt: { $exists: false } },
    [
      {
        $set: {
          expiresAt: {
            $add: [{ $ifNull: ["$createdAt", new Date()] }, NOTIFICATION_TTL_MS],
          },
        },
      },
    ],
  );

  // 2. Hard-delete anything already past the window, in a bounded batch. The TTL
  //    monitor would get there eventually; this makes the first run after
  //    deploying the change immediate and measurable.
  const stale = await Notification.find({ createdAt: { $lt: cutoff } })
    .select("_id")
    .limit(MAX_DELETES_PER_RUN)
    .lean();

  let deleted = 0;
  if (stale.length) {
    const res = await Notification.deleteMany({ _id: { $in: stale.map((s) => s._id) } });
    deleted = res.deletedCount ?? 0;
  }

  const remaining = await Notification.countDocuments({ createdAt: { $lt: cutoff } });

  return json({
    ok: true,
    retentionDays: Math.round(NOTIFICATION_TTL_MS / 86400000),
    cutoff,
    expiresAtBackfilled: backfill.modifiedCount ?? 0,
    notificationsDeleted: deleted,
    // If this is non-zero the cap was hit; the next daily run continues. Only
    // worth investigating if it never reaches zero.
    stillPendingDeletion: remaining,
    tookMs: Date.now() - startedAt,
  });
});

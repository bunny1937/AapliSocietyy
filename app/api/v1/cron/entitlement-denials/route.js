import { withRoute, json } from "@/lib/v1/http";
import { cronAuthorized } from "@/lib/v1/config";
import connectDB from "@/lib/mongodb";
import cache from "@/lib/cache";
import Society from "@/models/Society";
import EntitlementDenial from "@/models/EntitlementDenial";
import {
  windowStart,
  readBucket,
  clearBucket,
  listDenialSocieties,
  clearDenialIndex,
  bucketCrossesThreshold,
  summariseBucket,
} from "@/lib/entitlements/denials";
import { sendDenialAlert } from "@/lib/entitlements/denialAlert";
import { MODULES } from "@/lib/entitlements/modules";
import { normalizeFeatures } from "@/lib/entitlements/resolve";
import { withCronRun } from "@/lib/ops/cronTracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// One alert per society per day, at most.
const ALERT_COOLDOWN_SECONDS = 24 * 60 * 60;
const COOLDOWN_PREFIX = "entitlement-alert-sent:";
const MAX_SOCIETIES_PER_RUN = 50;

/**
 * GET /v1/cron/entitlement-denials
 *
 * cron-job.org, hourly:
 *   https://aaplisociety.vercel.app/v1/cron/entitlement-denials
 *   Header: Authorization: Bearer <CRON_SECRET>
 *
 * ## What it does
 *
 * Drains the hour-long Redis buckets middleware writes when it refuses a
 * module request, persists them, and — where the count crosses a threshold —
 * emails a superadmin.
 *
 * ## Why a drain job rather than writing directly
 *
 * The gate is in middleware, on the edge, where Mongo is unreachable. Redis is
 * the only thing both sides can see, so the aggregate lands there and this job
 * moves it across.
 *
 * ## Why it only ever reads *closed* windows
 *
 * The bucket for the current hour is still being written to. Draining it would
 * race every in-flight request and lose whatever arrived between the read and
 * the delete. So this run takes the previous hour and leaves the current one
 * alone; a bucket is only ever touched once, after nothing can add to it.
 *
 * That makes the job safe to run more than once an hour, and safe to miss a
 * run — a bucket lives three hours, so the next run picks it up.
 *
 * `?dryRun=1` reports without persisting, alerting or clearing.
 */
export const GET = withRoute(async (req) => {
  if (!cronAuthorized(req)) return json({ error: "Unauthorized" }, { status: 401 });
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  return json(await withCronRun("entitlement-denials", (ctx) => runDenialDrain(ctx.req))({ dryRun, req }));
});

async function runDenialDrain(req) {

  await connectDB();
  const startedAt = Date.now();
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";

  // The closed window. See the note above on why not the current one.
  const window = windowStart() - 60 * 60 * 1000;

  // Only societies the index says actually knocked. Everyone else costs
  // nothing.
  const societyIds = (await listDenialSocieties(window)).slice(0, MAX_SOCIETIES_PER_RUN);
  const societies = societyIds.length
    ? await Society.find({ _id: { $in: societyIds } })
        .select("name subscription.planType features")
        .lean()
    : [];

  const results = [];

  for (const society of societies) {
    const bucket = await readBucket(society._id, window);
    if (!bucket || !bucket.count) continue;

    const summary = summariseBucket(bucket);
    const crosses = bucketCrossesThreshold(bucket);
    const base = {
      societyId: String(society._id),
      societyName: society.name,
      denials: bucket.count,
      modules: summary.modules.map((m) => m.key),
      crossesThreshold: crosses,
    };

    if (dryRun) {
      results.push({ ...base, action: "would-process" });
      continue;
    }

    // Persist first. If the email fails we still have the record, and the
    // reverse — alerting on something we then failed to store — would leave a
    // support question with nothing behind it.
    const rows = [];
    for (const mod of summary.modules) {
      for (const user of summary.users.length ? summary.users : [{ id: null, name: null, role: null }]) {
        rows.push({
          societyId: society._id,
          societyName: society.name,
          module: mod.key,
          userId: user.id || null,
          userName: user.name || null,
          role: user.role || null,
          method: bucket.lastMethod || null,
          path: summary.paths[0]?.path || null,
          ip: bucket.lastIp || null,
          surface: summary.surfaces[0]?.surface || null,
          at: new Date(bucket.last),
        });
      }
    }
    if (rows.length) await EntitlementDenial.insertMany(rows, { ordered: false }).catch(() => {});

    let alert = { sent: 0, skipped: "below threshold" };
    if (crosses) {
      const cooldownKey = `${COOLDOWN_PREFIX}${society._id}`;
      const recentlyAlerted = await cache.get(cooldownKey);
      if (recentlyAlerted) {
        alert = { sent: 0, skipped: "already alerted today" };
      } else {
        const entitled = MODULES.filter((m) => normalizeFeatures(society.features)[m.key]).map(
          (m) => m.label,
        );
        alert = await sendDenialAlert({
          societyName: society.name,
          societyId: String(society._id),
          summary,
          plan: society.subscription?.planType,
          entitled,
        });
        if (alert.sent) await cache.set(cooldownKey, "1", ALERT_COOLDOWN_SECONDS);
      }
    }

    // Only now — a cleared bucket that was never stored is a lost signal.
    await clearBucket(society._id, window);

    results.push({ ...base, action: "processed", stored: rows.length, alert });
  }

  // The index is only safe to drop once every bucket it named has been
  // handled, which is the loop above.
  if (!dryRun && societyIds.length) await clearDenialIndex(window);

  return {
    ok: true,
    dryRun,
    window: new Date(window).toISOString(),
    societiesWithDenials: results.length,
    alertsSent: results.filter((r) => r.alert?.sent).length,
    results,
    tookMs: Date.now() - startedAt,
  };
}

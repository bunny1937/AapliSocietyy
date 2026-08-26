import mongoose from "mongoose";

/**
 * One row per cron execution.
 *
 * ## Why a collection and not a log line
 *
 * A log line answers "what happened when it ran". The question that actually
 * bites is "did it run at all", and no log can answer that — the absence of a
 * run writes nothing. Health is computed by comparing the newest row here
 * against the expected interval in lib/ops/cronRegistry.js, so a job that has
 * never run has no row, and no row is itself the alarm.
 *
 * ## Why the summary is capped
 *
 * A purge run can touch dozens of societies. Storing the full result would make
 * this collection larger than some of the collections it reports on. The
 * handlers return their detail to the caller as before; what lands here is the
 * headline — counts and outcome — plus the first few lines of any error.
 *
 * TTL is 90 days. Long enough to answer "has this been failing all quarter",
 * short enough that it never becomes a storage problem.
 */
const CronRunSchema = new mongoose.Schema(
  {
    // Matches a key in CRON_JOBS. Indexed with startedAt because every read is
    // "the newest run for this job".
    job: { type: String, required: true, index: true },
    startedAt: { type: Date, required: true, default: Date.now },
    finishedAt: { type: Date },
    tookMs: { type: Number },

    ok: { type: Boolean, required: true, default: false },
    dryRun: { type: Boolean, default: false },

    // Who pulled the trigger: "cron" for the scheduler, or a superadmin userId
    // when run by hand from the operations dashboard.
    trigger: { type: String, default: "cron" },
    actorUserId: { type: String, default: null },

    // Headline numbers the handler chose to report. Free-form but small.
    summary: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Present only on failure. Truncated — a stack trace is for the log, this
    // is for the dashboard row.
    error: { type: String },

    // Set when this run's watchdog found other jobs late or stale, so the
    // dashboard can show which run raised the alarm.
    alertedJobs: [{ type: String }],
  },
  { timestamps: true },
);

CronRunSchema.index({ job: 1, startedAt: -1 });
// 90 days. Deliberately not a capped collection: a capped collection would
// evict by total size, so a chatty hourly job could push out the daily job's
// only evidence of failure.
CronRunSchema.index({ startedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.models.CronRun || mongoose.model("CronRun", CronRunSchema);

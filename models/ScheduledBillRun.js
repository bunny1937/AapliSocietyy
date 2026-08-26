// models/ScheduledBillRun.js
//
// Backs step 4 of the flow: "Push now or Schedule next month's generation".
//
// One document per (society, period). Upserted, so re-scheduling the same
// period moves the date instead of creating a duplicate run.
//
// The existing cron-job.org daily hit on /v1/cron/billing-admin-reminders is
// the natural place to pick these up -- see the query at the bottom of this
// file. No vercel.json change and no new external cron entry is required.

import mongoose from "mongoose";

const ScheduledBillRunSchema = new mongoose.Schema(
  {
    societyId: { type: String, required: true, index: true },

    // YYYY-MM of the period to be generated.
    periodId: { type: String, required: true },

    billSeries: { type: String, enum: ["RESIDENTIAL", "COMMERCIAL"], default: "RESIDENTIAL" },

    // When the generation should fire. Stored UTC.
    runAt: { type: Date, required: true, index: true },

    status: {
      type: String,
      enum: ["SCHEDULED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"],
      default: "SCHEDULED",
      index: true,
    },

    createdBy: { type: String },
    cancelledBy: { type: String },
    cancelledAt: { type: Date },

    startedAt: { type: Date },
    completedAt: { type: Date },
    billsCreated: { type: Number, default: 0 },
    error: { type: String },

    // Guards against a slow run being picked up twice by overlapping crons.
    lockedAt: { type: Date },
  },
  { timestamps: true },
);

// One schedule per society per period. This is what makes the upsert in
// commit/route.js safe to call repeatedly.
ScheduledBillRunSchema.index({ societyId: 1, periodId: 1, billSeries: 1 }, { unique: true });

// The due-runs query.
ScheduledBillRunSchema.index({ status: 1, runAt: 1 });

/**
 * Claim the next due run atomically. Returns null when there is nothing to do.
 *
 * Usage from a cron route:
 *
 *   let run;
 *   while ((run = await ScheduledBillRun.claimNextDue())) {
 *     await generateBillsForPeriod(run.societyId, run.periodId);
 *     await ScheduledBillRun.updateOne(
 *       { _id: run._id },
 *       { $set: { status: "COMPLETED", completedAt: new Date() } },
 *     );
 *   }
 *
 * The findOneAndUpdate is the lock. Two overlapping cron invocations cannot
 * both claim the same document, so a slow generation will not be started twice.
 */
ScheduledBillRunSchema.statics.claimNextDue = function (now = new Date()) {
  const staleLock = new Date(now.getTime() - 15 * 60 * 1000);
  return this.findOneAndUpdate(
    {
      runAt: { $lte: now },
      $or: [
        { status: "SCHEDULED" },
        // Recover a run whose function died mid-flight.
        { status: "RUNNING", lockedAt: { $lt: staleLock } },
      ],
    },
    { $set: { status: "RUNNING", startedAt: now, lockedAt: now } },
    { new: true, sort: { runAt: 1 } },
  ).lean();
};

export default mongoose.models.ScheduledBillRun ||
  mongoose.model("ScheduledBillRun", ScheduledBillRunSchema);

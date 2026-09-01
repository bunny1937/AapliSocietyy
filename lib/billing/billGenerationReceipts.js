/**
 * Write and read BillGenerationReceipt rows. SERVER ONLY.
 * See models/BillGenerationReceipt.js for what this is and why.
 */
import { randomUUID } from "crypto";
import mongoose from "mongoose";
import BillGenerationReceipt from "@/models/BillGenerationReceipt";
import User from "@/models/User";

/**
 * @param {object} args
 * @param {string} args.societyId
 * @param {string} args.billPeriodId
 * @param {string} args.billSeries
 * @param {string} args.actorId
 * @param {Date} args.startedAt
 * @param {string} [args.publishMode]
 * @param {{created:number, failed:number}} [args.counts] present on completion (even partial)
 * @param {Array<{memberId,error}>} [args.errors]
 * @param {string} [args.error] present only if the run threw before finishing
 */
export async function writeBillGenerationReceipt({
  societyId, billPeriodId, billSeries, actorId, startedAt, publishMode, counts, errors, error,
}) {
  const finishedAt = new Date();
  const runId = randomUUID();
  const actor = actorId ? await User.findById(actorId).select("name").lean().catch(() => null) : null;

  const status = error
    ? "failed"
    : (counts?.failed || 0) > 0
      ? "partial"
      : "ok";

  return BillGenerationReceipt.create({
    societyId, billPeriodId, billSeries, runId, status,
    counts: { created: counts?.created || 0, failed: counts?.failed || 0 },
    memberErrors: errors || [],
    publishMode: publishMode || null,
    startedAt, finishedAt, durationMs: finishedAt - startedAt,
    actorId: actorId || undefined,
    actorName: actor?.name || "",
    error: error || null,
  });
}

/** Latest receipt for one society/period/series. Never throws. */
export async function getLatestBillGenerationReceipt(societyId, billPeriodId, billSeries) {
  const sid = new mongoose.Types.ObjectId(String(societyId));
  return BillGenerationReceipt.findOne({ societyId: sid, billPeriodId, billSeries })
    .sort({ startedAt: -1 })
    .lean()
    .catch(() => null);
}

/** Recent receipts for a society, newest first — for a "recent runs" list. */
export async function listBillGenerationReceipts(societyId, { limit = 20 } = {}) {
  const sid = new mongoose.Types.ObjectId(String(societyId));
  return BillGenerationReceipt.find({ societyId: sid }).sort({ startedAt: -1 }).limit(limit).lean().catch(() => []);
}

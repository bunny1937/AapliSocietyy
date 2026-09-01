/**
 * Write and read AccountingSetupReceipt rows. SERVER ONLY.
 * See models/AccountingSetupReceipt.js for what this is and isn't.
 */
import { randomUUID } from "crypto";
import mongoose from "mongoose";
import AccountingSetupReceipt from "@/models/AccountingSetupReceipt";
import User from "@/models/User";

/**
 * @param {object} args
 * @param {string} args.societyId
 * @param {string} args.step
 * @param {string} args.userId
 * @param {Date} args.startedAt
 * @param {{created?:string[], skipped?:string[]}} [args.result] present on success
 * @param {{code?:string, message:string}} [args.error] present on failure
 */
export async function writeSetupReceipt({ societyId, step, userId, startedAt, result, error }) {
  const finishedAt = new Date();
  const runId = randomUUID();
  const actor = userId ? await User.findById(userId).select("name").lean().catch(() => null) : null;

  return AccountingSetupReceipt.create({
    societyId,
    step,
    runId,
    status: error ? "failed" : "ok",
    createdRefs: result?.created || [],
    skippedRefs: result?.skipped || [],
    counts: {
      created: result?.created?.length || 0,
      skipped: result?.skipped?.length || 0,
    },
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    actorId: userId || undefined,
    actorName: actor?.name || "",
    error: error ? { code: error.code, message: error.message } : undefined,
  });
}

/** Latest receipt per step for a society, keyed by step. Never throws. */
export async function getLatestReceipts(societyId, stepKeys) {
  // aggregate() skips Mongoose's normal query-cast, so a string societyId
  // here would $match nothing — every receipt would silently vanish.
  const sid = new mongoose.Types.ObjectId(String(societyId));
  const rows = await AccountingSetupReceipt.aggregate([
    { $match: { societyId: sid } },
    { $sort: { startedAt: -1 } },
    { $group: { _id: "$step", doc: { $first: "$$ROOT" } } },
  ]).catch(() => []);

  const byStep = {};
  for (const row of rows) {
    const d = row.doc;
    byStep[row._id] = {
      status: d.status,
      at: d.finishedAt,
      actorName: d.actorName || null,
      counts: d.counts,
      error: d.error || null,
    };
  }
  // Always return every requested key, even with no receipt yet — the
  // caller reads `byStep[key]` unconditionally.
  for (const key of stepKeys || []) {
    if (!byStep[key]) byStep[key] = null;
  }
  return byStep;
}

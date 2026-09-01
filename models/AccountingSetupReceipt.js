/**
 * AccountingSetupReceipt — the persisted half of "did this step really run".
 * ============================================================================
 * The three seeded setup steps (postingRules, validationRules, schedules)
 * write to global rows (societyId: null), so a live query can only ever
 * answer "do the defaults exist", never "did THIS society press run, when,
 * and what happened". This is that second half — one row per run, kept
 * forever, so `12 Apr 2026 · by Suresh Patil` is a fact on disk, not a
 * sentence the UI made up from whatever happened to still be in memory.
 *
 * `done` for a step is never decided from this collection alone — it stays a
 * live query against the real data (see setupSteps.js / AccountingSetupStateService.js),
 * so a receipt from a run that was later undone in the database (a head
 * deleted, a rule deactivated) never lies about the present. This collection
 * only answers "what happened, when, by whom" — the history a live query
 * cannot carry.
 *
 * See AapliSociety Accounting + Billing UX Overhaul §10, §12 Phase 2.
 * ============================================================================
 */
import mongoose from "mongoose";

const AccountingSetupReceiptSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    step: { type: String, required: true },
    runId: { type: String, required: true },
    status: { type: String, enum: ["ok", "failed"], required: true },

    createdRefs: { type: [String], default: [] },
    skippedRefs: { type: [String], default: [] },
    counts: {
      created: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
    },

    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, required: true },
    durationMs: { type: Number, default: 0 },

    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    actorName: { type: String, default: "" },

    error: {
      code: { type: String },
      message: { type: String },
    },
  },
  { timestamps: true },
);

// Reading "the latest receipt for this society's step" is the only query
// this collection ever serves.
AccountingSetupReceiptSchema.index({ societyId: 1, step: 1, startedAt: -1 });

export default mongoose.models.AccountingSetupReceipt ||
  mongoose.model("AccountingSetupReceipt", AccountingSetupReceiptSchema);

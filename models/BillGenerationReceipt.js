/**
 * BillGenerationReceipt — the persisted half of a bill run, mirroring
 * AccountingSetupReceipt (see that file's header for the full rationale).
 * ============================================================================
 * `/api/bills/generate-final` already streams live progress via NDJSON
 * (lib/ndjson-stream.js) — the "watch it happen" UX already existed here
 * before this addition. What was missing is what Setup had before Phase 2:
 * no trace survives a closed tab or a refresh. This is that trace — one row
 * per run, kept forever, additive only. Nothing about bill generation's own
 * logic changes; this only records what already happened.
 *
 * See AapliSociety Accounting + Billing UX Overhaul §12 Phase 6.
 * ============================================================================
 */
import mongoose from "mongoose";

const BillGenerationReceiptSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    billPeriodId: { type: String, required: true },
    billSeries: { type: String, enum: ["RESIDENTIAL", "COMMERCIAL"], required: true },
    runId: { type: String, required: true },
    status: { type: String, enum: ["ok", "partial", "failed"], required: true },

    counts: {
      created: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
    },
    // Named memberErrors, not `errors` — Mongoose reserves `errors` as a
    // Document-internal pathname (validation error introspection) and warns
    // at schema-compile time if you use it for your own data.
    memberErrors: { type: [{ memberId: String, error: String }], default: [] },

    publishMode: { type: String, default: null },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, required: true },
    durationMs: { type: Number, default: 0 },

    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    actorName: { type: String, default: "" },

    error: { type: String, default: null }, // set only when the whole run threw before finishing
  },
  { timestamps: true },
);

BillGenerationReceiptSchema.index({ societyId: 1, billPeriodId: 1, billSeries: 1, startedAt: -1 });

export default mongoose.models.BillGenerationReceipt ||
  mongoose.model("BillGenerationReceipt", BillGenerationReceiptSchema);

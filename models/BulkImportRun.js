import mongoose from "mongoose";

// One doc per bulk-import attempt. Client generates importRunId once and
// resends it on refresh/retry — this doc is the single source of truth for
// idempotency (duplicate submit guard) and real progress (polled by UI,
// not a fake client-side timer).
const BulkImportRunSchema = new mongoose.Schema(
  {
    importRunId: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: [
        "VALIDATING",
        "IMPORTING",
        "FINALIZING",
        "COMMITTED",
        "EMAIL_QUEUED",
        "COMPLETED",
        "FAILED",
        "ROLLED_BACK",
      ],
      default: "VALIDATING",
    },
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society" },
    stage: { type: String, default: "" }, // human label of current step
    processedCount: { type: Number, default: 0 },
    totalCount: { type: Number, default: 0 },
    warnings: [{ type: String }],
    errorMessages: [{ type: String }],
    result: { type: mongoose.Schema.Types.Mixed, default: null }, // final response payload, cached for idempotent replay
    // Set true the instant the society is exposed to normal queries and the
    // preview is marked used (see route.js). Past this point the society,
    // admin, members, and bills are REAL and onboarding emails may already
    // be sitting in real inboxes — a crash after this can never be cleaned
    // up by deleting importRunId-tagged docs, because that would orphan
    // users who already received working login links. compensateImportRun
    // must never run once this is true.
    pointOfNoReturn: { type: Boolean, default: false },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date },
  },
  { timestamps: true },
);
BulkImportRunSchema.index({ status: 1, startedAt: 1 });
export default mongoose.models.BulkImportRun ||
  mongoose.model("BulkImportRun", BulkImportRunSchema);

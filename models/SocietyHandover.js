import mongoose from "mongoose";

/**
 * One record per society offboarding handover.
 *
 * ## There is deliberately no payload field
 *
 * This document holds the manifest, the salt, the roots, the counts and the
 * delivery/confirmation receipts — and never the bundle itself. Same shape as
 * models/RetentionArchive.js, for the same reason: retaining the export is
 * exactly the thing the offboarding flow exists to avoid. The file is built on
 * demand, streamed, and forgotten.
 *
 * The manifest survives the purge (this collection has no societyId index into
 * SOCIETY_COLLECTIONS — see below), so after a society is gone we can still
 * answer "what was handed over, to whom, when, and did they confirm it."
 *
 * ## Not in SOCIETY_COLLECTIONS
 *
 * Deliberately NOT added to lib/superadmin/societyCollections.js. Everything
 * in that registry is exported and then destroyed by purgeSociety; a handover
 * record that deleted itself at purge time would erase the proof that the
 * handover happened, which is the one thing Rule 6 most wants kept. It holds
 * no personal data, so keeping it past the purge is safe.
 */
const SocietyHandoverSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    // Captured now — after a purge there is no Society document left to join to.
    societyName: { type: String },
    societySlug: { type: String },

    // ── what was handed over ──
    formatVersion: { type: Number, required: true },
    manifest: { type: mongoose.Schema.Types.Mixed, required: true },
    // The HMAC key for the manifest's leaves. Without it the manifest cannot be
    // recomputed and compared; with it, leaves still cannot be brute forced
    // back into values (see lib/superadmin/societyManifest.js).
    salt: { type: String, required: true },
    manifestRoot: { type: String, required: true, index: true },
    // SHA-256 of the exact bytes delivered, per artifact. This is what the
    // recipient's browser reproduces at confirmation time.
    artifacts: [
      {
        _id: false,
        format: { type: String, enum: ["json", "xlsx"], required: true },
        filename: String,
        sha256: { type: String, required: true },
        bytes: Number,
      },
    ],
    counts: {
      collections: Number,
      documents: Number,
      fields: Number,
    },

    // What was actually streamed, when they came to collect it.
    //
    // Not the same thing as `artifacts` above and deliberately kept apart. The
    // society may download days after the handover was built, and in a grace
    // window the society is paused but not frozen — a scheduled job or a late
    // reconciliation can still move a row. Rebuilding then produces different
    // bytes and therefore a different SHA-256.
    //
    // Overwriting `artifacts` would destroy the record of what was originally
    // certified; ignoring the difference would mean asking the recipient's
    // browser to confirm a digest their file cannot possibly have. So both are
    // kept, and `driftMismatchCount` below says whether the gap is benign.
    deliveredArtifacts: [
      {
        _id: false,
        format: { type: String, enum: ["json", "xlsx"] },
        filename: String,
        sha256: String,
        bytes: Number,
        at: Date,
      },
    ],

    // ── delivery ──
    // The society's own registered address(es) from the Society document.
    // Never an operator's address.
    recipients: [{ type: String }],
    // "registered" — from the Society document, the ordinary path.
    // "override"   — a superadmin typed an address in, because the society had
    //                none on file. Recorded rather than silently substituted:
    //                "who was told" is the question an auditor asks about a
    //                handover, and an operator-supplied address is a
    //                materially different answer from the society's own.
    recipientSource: { type: String, enum: ["registered", "override"], default: "registered" },
    overrideReason: { type: String },
    overrideByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // What was on file at the time, kept even when empty — it is the evidence
    // that the override was necessary rather than convenient.
    registeredRecipients: [{ type: String }],
    notifiedAt: { type: Date },
    notifyError: { type: String },
    // Gate on this, never on notifiedAt: a dispatched email proves nothing —
    // the address may be dead, the mail may bounce, it may sit in spam. Same
    // judgement as app/api/v1/cron/retention-purge's downloadedAt gate.
    // Chasing state, written by /v1/cron/society-handover-reminder. Kept here
    // rather than in a separate collection so "has this society been chased,
    // how often, and when did we stop" is answerable from the one row that
    // survives the purge.
    lastRemindedAt: { type: Date },
    reminderCount: { type: Number, default: 0 },
    downloadedAt: { type: Date },
    downloadedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // ── custody confirmation ──
    confirmedAt: { type: Date },
    confirmedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // What the confirmer's browser computed, for the audit trail.
    confirmedDigests: [
      {
        _id: false,
        format: String,
        sha256: String,
      },
    ],
    // Result of the live-state re-check performed at confirmation time.
    driftCheckedAt: { type: Date },
    driftMismatchCount: { type: Number },

    status: {
      type: String,
      enum: ["built", "notified", "downloaded", "confirmed", "superseded", "failed"],
      default: "built",
      index: true,
    },
    error: { type: String },

    // Rule 6 asks for a year of processing logs; 400 days covers a year plus
    // the slack to investigate something raised on day 365.
    willExpireAt: {
      type: Date,
      default: () => new Date(Date.now() + 400 * 24 * 60 * 60 * 1000),
      index: true,
    },
  },
  { timestamps: true },
);

// The current handover for a society is the newest one; older ones are marked
// superseded when a fresh export is taken.
SocietyHandoverSchema.index({ societyId: 1, createdAt: -1 });

export default mongoose.models.SocietyHandover ||
  mongoose.model("SocietyHandover", SocietyHandoverSchema);

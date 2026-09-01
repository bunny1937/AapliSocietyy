/**
 * AuditorNote — a query an auditor raises against an entry or an account
 * head, resolved by the admin. Replaces the WhatsApp loop (design doc §8,
 * §10, §12 Phase 5): "auditor raises a note against any entry or head; admin
 * sees it in the Hub's 'Do this next'; resolution is recorded."
 * ============================================================================
 * `targetType`/`targetId` is a loose reference (Voucher or ChartOfAccount) —
 * kept as a plain ObjectId + type string rather than two separate optional
 * refs, since exactly one target kind applies per note and a Mongoose
 * discriminator would be overkill for two shapes.
 * ============================================================================
 */
import mongoose from "mongoose";

const TARGET_TYPES = ["Voucher", "ChartOfAccount"];
const STATUSES = ["Open", "Resolved"];

const AuditorNoteSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    targetType: { type: String, enum: TARGET_TYPES, required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
    // Denormalized so a list of notes can render without N+1 lookups into
    // whichever collection targetType points at.
    targetLabel: { type: String, trim: true },
    note: { type: String, required: true, trim: true },
    status: { type: String, enum: STATUSES, default: "Open", index: true },
    raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    raisedAt: { type: Date, default: Date.now },
    resolution: { type: String, trim: true, default: "" },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

AuditorNoteSchema.index({ societyId: 1, status: 1, raisedAt: -1 });

AuditorNoteSchema.statics.TARGET_TYPES = TARGET_TYPES;
AuditorNoteSchema.statics.STATUSES = STATUSES;

export default mongoose.models.AuditorNote || mongoose.model("AuditorNote", AuditorNoteSchema);

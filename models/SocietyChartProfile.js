/**
 * SocietyChartProfile — one row per society, remembering which STANDARD_ACCOUNTS
 * template codes it deliberately removed.
 * ============================================================================
 * Before this: "missing" was computed as STANDARD_ACCOUNTS minus whatever
 * ChartOfAccount rows currently exist. Delete `5023 Inverter` and it comes
 * right back on the next setup-state read as "missing" — the Hub nags for it
 * forever, because a live diff against the raw template can't distinguish
 * "never created" from "created, then deliberately removed".
 *
 * This collection is that missing distinction. `removedCodes` is the only
 * field that matters going forward: a template code in it is never "missing"
 * again, only ever "available to add" if the admin changes their mind.
 * `adoptedCodes` is kept for symmetry / future per-society template
 * customisation (§12 Phase 3) but nothing currently reads it as authoritative
 * over the live ChartOfAccount rows.
 *
 * See AapliSociety Accounting + Billing UX Overhaul §12 Phase 3.
 * ============================================================================
 */
import mongoose from "mongoose";

const SocietyChartProfileSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, unique: true, index: true },
    adoptedCodes: { type: [String], default: [] },
    removedCodes: { type: [String], default: [] },
  },
  { timestamps: true },
);

export default mongoose.models.SocietyChartProfile ||
  mongoose.model("SocietyChartProfile", SocietyChartProfileSchema);

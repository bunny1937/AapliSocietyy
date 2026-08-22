import mongoose from "mongoose";
import { COMMERCIAL_SCHEMA_VERSION } from "@/lib/commercial/constants";

// Shop/Office rate table only — NEVER a residential column, so there is no
// shared-state ambiguity with models/BillingHead.js. See
// docs/superpowers/specs/2026-08-05-commercial-billing-separation-design.md.
const CommercialBillingHeadSchema = new mongoose.Schema(
  {
    schemaVersion: { type: Number, required: true, default: COMMERCIAL_SCHEMA_VERSION },
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    headName: { type: String, required: true, trim: true, maxlength: 120 },
    categoryScope: {
      type: [{ type: String, enum: ["Shop", "Office"] }],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: "categoryScope must include at least one of Shop, Office",
      },
    },
    calculationType: {
      type: String,
      enum: ["Fixed", "Per Sq Ft", "Percentage"],
      required: true,
    },
    rate: {
      type: new mongoose.Schema(
        {
          Shop: { type: Number, min: 0, default: null },
          Office: { type: Number, min: 0, default: null },
        },
        { _id: false },
      ),
      required: true,
    },
    // ---- Per-unit applicability -------------------------------------------
    // categoryScope above is a CLASS scope (Shop / Office) and can only ever be
    // all-or-nothing for that class. This is the UNIT scope:
    //   All      - every unit of the class is billed (maintenance, security...)
    //   OptIn    - billed only to shops that ticked it on their own record
    //              (signage, garbage, common electricity)
    //   Quantity - billed rate x the count allotted to that shop (parking)
    // Before this existed the engine charged every active head to every shop.
    applicability: {
      type: String,
      enum: ["All", "OptIn", "Quantity"],
      default: "All",
    },
    // Shown next to the number box on the shop form, e.g. "reserved parking
    // slots". Only meaningful when applicability === "Quantity".
    quantityLabel: { type: String, trim: true, maxlength: 60, default: null },
    // Stable slug (preset key for seeded heads) so a shop's opt-in survives the
    // head being renamed on the rate card. Nullable for admin-created heads.
    optInKey: { type: String, trim: true, maxlength: 60, default: null },

    isServiceCharge: { type: Boolean, default: false },
    nonOccupancyEligible: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0, min: 0, max: 9999 },
    notes: { type: String, trim: true, maxlength: 200, default: null },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deleteReason: { type: String, trim: true, maxlength: 200, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedReason: { type: String, trim: true, maxlength: 80, default: null },
  },
  { timestamps: true },
);

CommercialBillingHeadSchema.index({ societyId: 1, isDeleted: 1, isActive: 1 });
CommercialBillingHeadSchema.index({ societyId: 1, sortOrder: 1 });
// FIXED 2026-08-07: this unique index also covered SOFT-DELETED rows, so
// removing a charge and re-adding it with the same name failed with a raw
// MongoDB E11000 that reached the admin as "Request failed". Only LIVE heads
// need a unique name.
CommercialBillingHeadSchema.index(
  { societyId: 1, headName: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);

export default mongoose.models.CommercialBillingHead ||
  mongoose.model("CommercialBillingHead", CommercialBillingHeadSchema);

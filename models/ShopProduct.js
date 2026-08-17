import mongoose from "mongoose";

// A product sold by ONE shop inside ONE society.
//
// Scope: every read and write is keyed on societyId + shopId together. That is
// deliberate duplication — shopId alone would be enough to find the row, but
// carrying societyId means a leaked/guessed product id from another society
// cannot match, and the isolation is enforced by the index rather than by
// remembering to compare fields in each caller.
//
// Stock is OPTIONAL (`trackStock`). Most society shops — a salon, a tailor, a
// tiffin service — do not count units, and forcing them to would make the
// inventory screen a chore they abandon. When it IS on, three numbers matter:
//
//   quantity          what physically exists
//   reservedQuantity  what is promised to orders that are not finished yet
//   available         quantity - reservedQuantity (what a member may still buy)
//
// Reservation happens at order placement, so two members cannot both buy the
// last packet. Nothing outside lib/commercial/shopOrderService.js should touch
// reservedQuantity.
const ShopProductSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
      index: true,
    },
    // Society-shared category list (models/CommercialCategory.js) — the same
    // one the shop itself is classified with. Optional: a small shop with
    // twenty items does not need to file them.
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CommercialCategory",
      default: null,
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    // Lower-cased name, maintained here and never by callers. Exists only so
    // "Amul Milk" and "amul milk" cannot both be listed in one shop, which
    // looks like a bug to every member who sees the list.
    nameKey: { type: String, required: true },
    description: { type: String, trim: true, maxlength: 600, default: "" },
    // Free text on purpose: "500 g", "1 plate", "per kg", "dozen". A fixed enum
    // of units cannot describe what these shops actually sell.
    unitLabel: { type: String, trim: true, maxlength: 24, default: "" },
    price: { type: Number, required: true, min: 0, max: 1000000 },
    imageKey: { type: String, default: null },
    // Off = hidden from members, kept for the owner. Deleting a product that
    // appears in past orders would not remove it from those orders (they hold
    // their own snapshots), but the owner still wants their list back.
    isActive: { type: Boolean, default: true },
    trackStock: { type: Boolean, default: false },
    quantity: { type: Number, default: 0, min: 0 },
    reservedQuantity: { type: Number, default: 0, min: 0 },
    // At or below this, members see "Low stock" instead of "Available". 0 means
    // "only warn when it is actually finished".
    lowStockThreshold: { type: Number, default: 0, min: 0 },
    // Per-order quantity limits a member can buy in one line. Both optional:
    // null means "no limit" (most items — a resident buying 1 or 40 tomatoes
    // is the shop's business, not the app's). When set, the member catalogue
    // and order placement both enforce them, so a shop that caps "max 2 cakes
    // per order" cannot be bypassed by an app that doesn't know the cap exists.
    minOrderQty: { type: Number, default: null, min: 1 },
    maxOrderQty: { type: Number, default: null, min: 1 },
    sortOrder: { type: Number, default: 100 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

ShopProductSchema.virtual("availableQuantity").get(function () {
  if (this.trackStock !== true) return null;
  return Math.max(0, Number(this.quantity || 0) - Number(this.reservedQuantity || 0));
});

ShopProductSchema.pre("validate", function (next) {
  if (typeof this.name === "string") {
    this.nameKey = this.name.trim().toLowerCase();
  }
  // Money is stored as rupees with paise, not floats with a tail. Prices are
  // shown, added up and printed on receipts, so 19.999 must never enter.
  if (typeof this.price === "number" && Number.isFinite(this.price)) {
    this.price = Math.round(this.price * 100) / 100;
  }
  // Untracked stock keeps its numbers at zero rather than at stale values, so
  // turning tracking back on later does not resurrect a count from months ago.
  if (this.trackStock !== true) {
    this.quantity = 0;
    this.lowStockThreshold = 0;
  }
  next();
});

// One name per shop, ignoring case, ignoring soft-deleted rows.
ShopProductSchema.index(
  { shopId: 1, nameKey: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);
// The two list queries: the owner's inventory and the member's catalogue.
ShopProductSchema.index({ societyId: 1, shopId: 1, isDeleted: 1, isActive: 1, sortOrder: 1, name: 1 });
ShopProductSchema.index({ societyId: 1, shopId: 1, categoryId: 1, isActive: 1 });

export default mongoose.models.ShopProduct || mongoose.model("ShopProduct", ShopProductSchema);

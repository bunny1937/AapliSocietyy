import mongoose from "mongoose";

// models/Shop.js
//
// NEW 2026-08-07. A shop is its OWN record. It is not a Member with
// flatType: "Shop".
//
// WHY THIS EXISTS
// ---------------
// The previous approach classified a unit as commercial by OVERWRITING
// Member.flatType to "Shop". That was destructive and it is exactly what went
// wrong with A-103: it was a flat, it was marked as a shop, and its residential
// identity was gone. There was no "also" — only "instead". A member cannot be a
// flat and a shop at the same time when the same field encodes both.
//
// A shop now:
//   - has its OWN area (`areaSqft`), never borrowed from a flat
//   - LINKS to an owner, optionally, without changing anything on that record
//   - can exist with no member at all (non-resident shopkeeper), which is the
//     stated requirement for later
//
// Deleting a shop therefore cannot damage a flat, and marking a flat's shop
// inactive cannot stop the flat being billed residentially.

const ShopSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },

    // ---- Identity -------------------------------------------------------
    // Its own address within the society. A shop may sit at the same street
    // position as a flat and must still be addressable separately.
    shopNo: { type: String, required: true, trim: true, maxlength: 20 },
    wing: { type: String, trim: true, maxlength: 20, default: null },
    floor: { type: Number, min: -3, max: 150, default: 0 },

    unitKind: {
      type: String,
      enum: ["Shop", "Office"],
      required: true,
      default: "Shop",
    },

    // ---- Ownership link (OPTIONAL BY DESIGN) ----------------------------
    // Exactly one of these may be set, or neither.
    //   ownerMemberId -> a society member also owns this shop
    //   ownerUserId   -> an outside party owns it (future non-resident case)
    //   neither       -> recorded against a plain name only
    //
    // Setting ownerMemberId writes NOTHING to that Member. It is a reference,
    // not a reclassification.
    ownerMemberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Member",
      default: null,
      index: true,
    },
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    // Always populated so a bill can be addressed even with no link at all.
    ownerName: { type: String, required: true, trim: true, maxlength: 160 },
    ownerPhone: { type: String, trim: true, maxlength: 20, default: null },
    ownerEmail: { type: String, trim: true, lowercase: true, maxlength: 160, default: null },

    // ---- Area: the shop's OWN figure ------------------------------------
    // Deliberately ONE number, not carpet/built-up/super. Commercial rent and
    // society charges in Indian markets are quoted on a single agreed figure,
    // and three fields is precisely what made the flat side ambiguous.
    // `areaBasisNote` records what that figure represents, for the record only
    // — it never changes the arithmetic.
    areaSqft: {
      type: Number,
      required: true,
      min: 1,
      max: 1000000,
    },
    areaBasisNote: {
      type: String,
      enum: ["Carpet", "Built-up", "Super built-up", "Agreed/Other"],
      default: "Carpet",
    },

    // ---- Occupancy -------------------------------------------------------
    occupancyType: {
      type: String,
      enum: ["Owner-Occupied", "Rented out", "Vacant"],
      default: "Owner-Occupied",
    },
    tenantName: { type: String, trim: true, maxlength: 160, default: null },
    tenantPhone: { type: String, trim: true, maxlength: 20, default: null },
    leaseStartDate: { type: Date, default: null },
    leaseEndDate: { type: Date, default: null },

    // ---- Trade details ---------------------------------------------------
    tradeName: { type: String, trim: true, maxlength: 160, default: null },
    // FIXED 2026-08-14: this said ref: "BusinessCategory", a model that is not
    // registered anywhere. The live category model is CommercialCategory
    // (models/CommercialCategory.js), which is what the admin picker and the
    // member directory filter both read. The wrong ref meant any populate() of
    // a shop's category threw MissingSchemaError, which is why nothing had
    // ever populated it. Storage format is unchanged — this is a reference fix,
    // not a data change.
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CommercialCategory",
      default: null,
    },
    gstin: { type: String, trim: true, uppercase: true, maxlength: 15, default: null },
    shopActNumber: { type: String, trim: true, maxlength: 40, default: null },
    fssaiNumber: { type: String, trim: true, maxlength: 20, default: null },

    // ---- Utilities -------------------------------------------------------
    // Default is that the shop pays its own electricity bill directly, which is
    // the common arrangement. Society-managed sub-meter recovery is opt-in per
    // shop and only applies when the society has enabled it on the rate card.
    electricityMode: {
      type: String,
      enum: ["Own connection", "Society-managed sub-meter"],
      default: "Own connection",
    },
    electricityMeterNo: { type: String, trim: true, maxlength: 40, default: null },
    lastMeterReading: { type: Number, min: 0, default: null },
    lastMeterReadingDate: { type: Date, default: null },

    waterConnectionNo: { type: String, trim: true, maxlength: 40, default: null },
    shutterCount: { type: Number, min: 0, max: 50, default: 1 },
    hasSignage: { type: Boolean, default: false },
    signageSizeSqft: { type: Number, min: 0, default: null },

    emergencyContactName: { type: String, trim: true, maxlength: 120, default: null },
    emergencyContactPhone: { type: String, trim: true, maxlength: 20, default: null },

    // ---- Public storefront (member-facing) -------------------------------
    // ADDED 2026-08-14 for the member "Society Shops" experience.
    //
    // This is deliberately a sub-document on Shop, NOT a migration of the old
    // BusinessProfile module. Shop is already the canonical commercial unit:
    // ownership, the Commercial login profile (claims.shopId), owner profile
    // edit requests and commercial bill generation all key off it. Putting the
    // public fields anywhere else would recreate the two-sources-of-truth
    // problem the Shop model was introduced to end.
    //
    // Every field is optional and every default is the CURRENT behaviour: an
    // existing shop loads with isPublished false and therefore does not appear
    // in the member directory until an admin publishes it.
    storefront: {
      // Publication is an ADMIN decision (approved product rule). An owner can
      // request changes, but only the society decides what residents see.
      isPublished: { type: Boolean, default: false },
      publishedAt: { type: Date, default: null },
      publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

      tagline: { type: String, trim: true, maxlength: 120, default: null },
      description: { type: String, trim: true, maxlength: 2000, default: null },

      // Hours are wall-clock hours in this timezone. The SERVER decides whether
      // a shop is open (lib/commercial/shopStorefront.js) so a device with a
      // wrong clock can never show a closed shop as open.
      timezone: { type: String, trim: true, maxlength: 64, default: "Asia/Kolkata" },
      weeklyHours: {
        type: [
          new mongoose.Schema(
            {
              dayOfWeek: { type: Number, min: 0, max: 6, required: true },
              isClosed: { type: Boolean, default: false },
              intervals: {
                type: [
                  new mongoose.Schema(
                    {
                      opensAt: { type: String, required: true, maxlength: 5 },
                      closesAt: { type: String, required: true, maxlength: 5 },
                    },
                    { _id: false },
                  ),
                ],
                default: [],
              },
            },
            { _id: false },
          ),
        ],
        default: [],
      },
      // Dated exceptions (festival closure, one-off late opening). An override
      // for today always beats the weekly pattern.
      hourOverrides: {
        type: [
          new mongoose.Schema(
            {
              date: { type: String, required: true, maxlength: 10 }, // YYYY-MM-DD, local
              label: { type: String, trim: true, maxlength: 80, default: null },
              isClosed: { type: Boolean, default: true },
              intervals: {
                type: [
                  new mongoose.Schema(
                    {
                      opensAt: { type: String, required: true, maxlength: 5 },
                      closesAt: { type: String, required: true, maxlength: 5 },
                    },
                    { _id: false },
                  ),
                ],
                default: [],
              },
            },
            { _id: false },
          ),
        ],
        default: [],
      },
      // Owner's "closed right now" switch: higher precedence than any hours,
      // because a shut shutter is a fact and a schedule is only a plan.
      manualClosed: { type: Boolean, default: false },
      manualClosedNote: { type: String, trim: true, maxlength: 160, default: null },

      // Fulfilment is per shop. A member may only pick a mode the shop offers.
      pickupEnabled: { type: Boolean, default: false },
      deliveryEnabled: { type: Boolean, default: false },
      deliveryNote: { type: String, trim: true, maxlength: 240, default: null },
      minOrderAmount: { type: Number, min: 0, default: null },

      // Offline payment only in V1. The shop declares what it accepts.
      offlinePaymentMethods: {
        type: [{ type: String, enum: ["PAY_AT_SHOP", "PAY_ON_DELIVERY", "UPI_ON_PICKUP", "UPI_ON_DELIVERY"] }],
        default: [],
      },

      // Public contact details, kept separate from ownerPhone/ownerEmail so
      // publishing a storefront never exposes the owner's private contact.
      publicPhone: { type: String, trim: true, maxlength: 20, default: null },
      publicWhatsapp: { type: String, trim: true, maxlength: 20, default: null },
      publicEmail: { type: String, trim: true, lowercase: true, maxlength: 160, default: null },

      logoKey: { type: String, trim: true, maxlength: 300, default: null },
      coverKey: { type: String, trim: true, maxlength: 300, default: null },
      mediaVersion: { type: Number, default: 0 },

      updatedAt: { type: Date, default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },

    // ---- Commercial ledger openings -------------------------------------
    // A shop's dues are ITS OWN. The A-103 bug was the commercial run
    // inheriting the flat's Rs 1,335 residential opening balance. These fields
    // exist so the commercial ledger can never again read a Member's.
    openingPrincipal: { type: Number, default: 0, min: 0 },
    openingInterest: { type: Number, default: 0, min: 0 },

    // ---- Billing state ---------------------------------------------------
    isBillable: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// A shop number is unique within a society, among live records only, so a
// deleted shop's number can be reused.
ShopSchema.index(
  { societyId: 1, wing: 1, shopNo: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);
ShopSchema.index({ societyId: 1, isDeleted: 1, isActive: 1 });
ShopSchema.index({ societyId: 1, ownerMemberId: 1 });
ShopSchema.index({ societyId: 1, ownerUserId: 1 });
// The member directory's only query shape: published + live shops in one
// society, ordered by trade name. Without this it is a collection scan on the
// most frequently opened member screen after the dashboard.
ShopSchema.index({ societyId: 1, "storefront.isPublished": 1, isActive: 1, tradeName: 1 });
ShopSchema.index({ societyId: 1, "storefront.isPublished": 1, categoryId: 1 });

// Label used on bills and screens: "A-103 (Shop)" or "103 (Shop)".
ShopSchema.virtual("unitLabel").get(function () {
  return [this.wing, this.shopNo].filter(Boolean).join("-");
});

ShopSchema.pre("save", function (next) {
  // A shop cannot be owned by a member AND an outside user at once.
  if (this.ownerMemberId && this.ownerUserId) {
    return next(
      new Error("A shop can be linked to a member or an outside owner, not both."),
    );
  }
  // Rented out with no tenant recorded is a data hole that surfaces later as a
  // wrong non-occupancy charge, so it is caught here.
  if (this.occupancyType === "Rented out" && !this.tenantName) {
    return next(new Error("Record the tenant's name for a shop marked as rented out."));
  }
  next();
});

export default mongoose.models.Shop || mongoose.model("Shop", ShopSchema);

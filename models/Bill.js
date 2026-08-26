import mongoose from "mongoose";
const BillSchema = new mongoose.Schema(
  {
    billPeriodId: {
      type: String,
      required: true,
      index: true,
    },
    billMonth: {
      type: Number,
      required: true,
      min: 0,
      max: 12,
    },
    billYear: {
      type: Number,
      required: true,
    },
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Member",
      // Required for a RESIDENTIAL bill (it IS the unit). Optional for
      // COMMERCIAL — it's the shop's owner, and a shop can be linked to no
      // member at all (models/Shop.js: ownerMemberId is nullable). The unit
      // a commercial bill is for is always `shopId`, never this field.
      required: function () {
        return this.billSeries !== "COMMERCIAL";
      },
      index: true,
    },
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    // ── Immutable bill-state fields (set at generation, never mutated) ──────
    // openingPrincipal = previous month's closingPrincipal
    openingPrincipal: { type: Number, default: 0 },
    // openingInterest = previous month's closingInterest
    openingInterest: { type: Number, default: 0 },
    // currentCharges = sum of this month's maintenance + fixed + custom heads
    currentCharges: { type: Number, default: 0 },
    // currentInterest = openingPrincipal × annualRate / 1200 (simple, non-compounding)
    currentInterest: { type: Number, default: 0 },
    // billPrincipalBalance = openingPrincipal + currentCharges (immutable)
    billPrincipalBalance: { type: Number, default: 0 },
    // billInterestBalance = openingInterest + currentInterest (immutable)
    billInterestBalance: { type: Number, default: 0 },
    // totalBillDue = billPrincipalBalance + billInterestBalance (immutable)
    totalBillDue: { type: Number, default: 0 },
    // ── Closing-state fields (set after payment, separate from bill state) ──
   // Ledger V2: no-null closing values. Generation sets these = opening+current.
closingPrincipal: { type: Number, default: 0 },
closingInterest: { type: Number, default: 0 },
closingTotal: { type: Number, default: 0 },
    paymentUploadedAt: { type: Date, default: null },
    paymentImportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PaymentImport",
      default: null,
    },
    // ── Legacy / compat fields (kept for existing generate route + reports) ─
    previousBalance: { type: Number, default: 0 },
    previousPrincipal: { type: Number, default: 0 },
    previousInterest: { type: Number, default: 0 },
    currInt: { type: Number, default: 0 },
    monthInterest: { type: Number, default: 0 },
    interestAmount: { type: Number, default: 0 },
    principalBalance: { type: Number, default: 0 },
    interestBalance: { type: Number, default: 0 },
    subtotal: Number,
    serviceTax: { type: Number, default: 0 },
    currentBillTotal: Number,
    charges: {
      type: Map,
      of: Number,
      default: new Map(),
    },
    // Commercial billing separation (additive; null/"RESIDENTIAL" for every
    // bill generated before this and every residential bill generated after —
    // byte-identical to today). See lib/billing/generationService.js.
    unitClass: { type: String, enum: ["Shop", "Office", null], default: null },
    // NEW 2026-08-07 — a COMMERCIAL bill belongs to a SHOP, not a flat.
    // memberId stays populated (the owner, for addressing and for the member
    // app) but it is no longer what the bill is *for*. That separation is what
    // stops one unit being billed in both series off one area and one balance.
    shopId: { type: mongoose.Schema.Types.ObjectId, ref: "Shop", default: null, index: true },
    // Frozen at generation (Q12): correcting an area later must never silently
    // rewrite a bill that has already gone out.
    unitAreaAtGeneration: { type: Number, default: null },
    billSeries: { type: String, enum: ["RESIDENTIAL", "COMMERCIAL"], default: "RESIDENTIAL" },
    billNo: { type: String, default: null },
    totalAmount: {
      type: Number,
      required: true,
    },
    amountPaid: {
      type: Number,
      default: 0,
      min: 0,
    },
    balanceAmount: {
      type: Number,
      required: true,
    },
    advanceApplied: { type: Number, default: 0 },
    dueDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      // Scheduled: generated but not yet visible to member (pushDate not reached)
      enum: ["Scheduled", "Unpaid", "Partial", "PaymentDone", "Paid", "Overdue"],
      default: "Unpaid",
      index: true,
    },
    // Set when bill is generated before billPushDay. Cron flips to 'Unpaid' on this date.
    scheduledPushDate: { type: Date, default: null },
    // Cash / manual "Payment Done" acknowledgement recorded BEFORE the
    // confirming payment Excel is uploaded. This does NOT touch the ledger or
    // allocation — the Excel upload is what allocates the payment and flips the
    // status to "Paid". Cleared automatically once that finalization happens.
    pendingPayment: {
      amount: { type: Number, default: null },
      paymentMode: { type: String, default: null },
      paymentDate: { type: Date, default: null },
      notes: { type: String, default: null },
      recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      recordedAt: { type: Date, default: null },
    },
    importedFrom: {
      type: String,
      enum: ["Manual", "Excel", "API", "System", "BulkImport"],
      default: "System",
    },
    importBatchId: { type: String }, // ❌ REMOVED: index: true
    importMetadata: {
      fileName: String,
      uploadedAt: Date,
      rowNumber: Number,
      validationStatus: {
        type: String,
        enum: ["Valid", "Warning", "Error"],
        default: "Valid",
      },
      validationMessages: [String],
    },
    generationMetadata: {
      societyConfigVersion: Number,
      memberAreaAtGeneration: Number,
      ratesApplied: mongoose.Schema.Types.Mixed,
    },
    isLocked: {
      type: Boolean,
      default: false,
    },
    isHistoricalArchive: {
      type: Boolean,
      default: false,
      index: true,
    },
    importedFinancialYear: {
      type: String, // e.g. "2024-2025"
    },
    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    generatedAt: {
      type: Date,
      default: Date.now,
    },
    lastModifiedAt: {
      type: Date,
    },
    lastModifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    notes: {
      type: String,
      trim: true,
    },
   interestOverrideReason: { type: String, trim: true, default: null },
interestOverridden: { type: Boolean, default: false },
// ── Ledger V2 canonical audit/version fields (§12) ──
interestRateApplied: { type: Number, default: 0 },
schemaVersion: { type: Number, default: 2 },
calculationVersion: { type: Number, default: 1 },
rendererVersion: { type: Number, default: 1 },
engineVersion: { type: String, default: "Ledger V2" },
billPdfUrl: String,
    billHtml: String, // Stored HTML for preview and print
    renderedHtml: { type: String, select: false }, // stored but not returned by default
    // Set true when the admin commits the collection sheet for this bill's
    // own period (see collection-sheet/commit/route.js). Payability on the
    // member side keys off THIS, not off whether a later bill happens to
    // exist yet — a period the admin has processed is done, whether the
    // next bill gets generated tomorrow or a year from now. Any balance
    // still owed after closing keeps accruing as real debt (it is folded
    // into whatever bill comes next, whenever that is), it just stops being
    // shown as an urgent "pay this now" bill with its own due date.
    periodClosed: { type: Boolean, default: false },

    // Soft delete - NO INDEX HERE
    isDeleted: { type: Boolean, default: false }, // ❌ REMOVED: index: true
    deletedAt: { type: Date },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true,
  },
);
// ✅ ALL INDEXES DEFINED HERE (single place)
// One bill per member per period — but ONLY for residential bills.
//
// This index used to have no partial filter, and commercial bills store
// `memberId: null` (a shop can be owned by a non-resident with no Member
// record). In MongoDB a unique index treats missing/null as a value, so the
// FIRST commercial bill in a period inserted fine and the SECOND one failed
// with E11000 — bill generation for a society with two or more shops could not
// complete. Splitting it fixes that without weakening either guarantee.
//
// NOTE: adding a partial filter to an EXISTING index is not applied by Mongo on
// its own. Run scripts/fix-commercial-bill-indexes.mjs once per database.
BillSchema.index(
  { societyId: 1, billPeriodId: 1, memberId: 1 },
  {
    unique: true,
    partialFilterExpression: { memberId: { $type: "objectId" } },
    name: "uniq_residential_bill_per_period",
  },
);
// And one bill per shop per period, the commercial half of the same rule.
BillSchema.index(
  { societyId: 1, billPeriodId: 1, shopId: 1 },
  {
    unique: true,
    partialFilterExpression: { shopId: { $type: "objectId" } },
    name: "uniq_commercial_bill_per_period",
  },
);
BillSchema.index({ societyId: 1, status: 1, dueDate: 1 });
BillSchema.index({ status: 1, scheduledPushDate: 1 }); // for cron job query
BillSchema.index({ importBatchId: 1 }); // ✅ Defined here only
BillSchema.index({ "importMetadata.validationStatus": 1 });
BillSchema.index({ isDeleted: 1 }); // ✅ Defined here only
// Ledger V2 (§1, §5): balanceAmount is written explicitly by GenerationService /
// AllocationEngine as (closingPrincipal + closingInterest) and is NEVER
// recomputed on save. The former pre('save') hook was removed because silent
// recomputation is exactly what the immutability guarantee forbids.
export default mongoose.models.Bill || mongoose.model("Bill", BillSchema);

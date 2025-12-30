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
      max: 11,
    },
    billYear: {
      type: Number,
      required: true,
    },
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Member",
      required: true,
      index: true,
    },
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },

    charges: {
      type: Map,
      of: Number,
      default: new Map(),
    },

    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    amountPaid: {
      type: Number,
      default: 0,
      min: 0,
    },
    balanceAmount: {
      type: Number,
      default: 0,
    },
    dueDate: {
      type: Date,
      required: true,
    },

    status: {
      type: String,
      enum: ["Unpaid", "Partial", "Paid", "Overdue"],
      default: "Unpaid",
      index: true,
    },

    importedFrom: {
      type: String,
      enum: ["Manual", "Excel", "API", "System"],
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

    // Soft delete - NO INDEX HERE
    isDeleted: { type: Boolean, default: false }, // ❌ REMOVED: index: true
    deletedAt: { type: Date },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true,
  }
);

// ✅ ALL INDEXES DEFINED HERE (single place)
BillSchema.index(
  { societyId: 1, billPeriodId: 1, memberId: 1 },
  { unique: true }
);
BillSchema.index({ societyId: 1, status: 1, dueDate: 1 });
BillSchema.index({ importBatchId: 1 }); // ✅ Defined here only
BillSchema.index({ "importMetadata.validationStatus": 1 });
BillSchema.index({ isDeleted: 1 }); // ✅ Defined here only

BillSchema.pre("save", function (next) {
  this.balanceAmount = this.totalAmount - this.amountPaid;
  next();
});

export default mongoose.models.Bill || mongoose.model("Bill", BillSchema);

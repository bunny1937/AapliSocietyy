import mongoose from "mongoose";

const BillingHeadSchema = new mongoose.Schema(
  {
    headName: {
      type: String,
      required: true,
      trim: true,
    },
    calculationType: {
      type: String,
      enum: ["Fixed", "Per Sq Ft", "Percentage"],
      required: true,
    },
    defaultAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    canBeArchived: { type: Boolean, default: false },
isDeleted: { type: Boolean, default: false },
deletedAt: { type: Date },
deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
lastModifiedAt: { type: Date },
lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    order: {
      type: Number,
      default: 0,
    },
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

BillingHeadSchema.index({ societyId: 1, order: 1 });
BillingHeadSchema.index({ societyId: 1, headName: 1 }, { unique: true });
BillingHeadSchema.index({ societyId: 1, isDeleted: 1 });


export default mongoose.models.BillingHead ||
  mongoose.model("BillingHead", BillingHeadSchema);

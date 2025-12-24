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
    breakdown: {
      maintenance: { type: Number, default: 0 },
      sinkingFund: { type: Number, default: 0 },
      repairFund: { type: Number, default: 0 },
      fixedCharges: { type: Number, default: 0 },
      dynamicCharges: { type: Number, default: 0 },
      previousArrears: { type: Number, default: 0 },
      interestOnArrears: { type: Number, default: 0 },
      serviceTax: { type: Number, default: 0 },
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
  },
  {
    timestamps: true,
  }
);

BillSchema.index(
  { societyId: 1, billPeriodId: 1, memberId: 1 },
  { unique: true }
);
BillSchema.index({ societyId: 1, status: 1, dueDate: 1 });

BillSchema.pre("save", function (next) {
  this.balanceAmount = this.totalAmount - this.amountPaid;

  if (this.balanceAmount <= 0 && this.amountPaid > 0) {
    this.status = "Paid";
  } else if (this.amountPaid > 0 && this.balanceAmount > 0) {
    this.status = "Partial";
  } else if (new Date() > this.dueDate && this.balanceAmount > 0) {
    this.status = "Overdue";
  } else {
    this.status = "Unpaid";
  }

  next();
});

export default mongoose.models.Bill || mongoose.model("Bill", BillSchema);

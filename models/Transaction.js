import mongoose from "mongoose";

const TransactionSchema = new mongoose.Schema(
  {
    transactionId: {
      type: String,
      unique: true,
      required: true,
      index: true,
    },
    date: {
      type: Date,
      required: true,
      index: true,
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
    type: {
      type: String,
      enum: ["Debit", "Credit"],
      required: true,
    },
    category: {
      type: String,
      required: true,
      enum: [
        "Maintenance",
        "Arrears",
        "Interest",
        "Payment",
        "Adjustment",
        "Refund",
        "Fine",
        "Opening Balance",
      ],
    },
    description: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    balanceAfterTransaction: {
      type: Number,
      required: true,
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "referenceModel",
    },
    referenceModel: {
      type: String,
      enum: ["Bill", "Payment", "Member"],
    },
    billPeriodId: {
      type: String,
      index: true,
    },
    paymentMode: {
      type: String,
      enum: ["Cash", "Cheque", "Online", "UPI", "NEFT", "RTGS", "System"],
    },
    paymentDetails: {
      chequeNo: String,
      bankName: String,
      transactionRef: String,
      upiId: String,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isReversed: {
      type: Boolean,
      default: false,
    },
    reversalTransactionId: {
      type: String,
    },
    financialYear: {
      type: String,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

TransactionSchema.index({ societyId: 1, memberId: 1, date: -1 });
TransactionSchema.index({ societyId: 1, category: 1, date: -1 });
TransactionSchema.index({ societyId: 1, financialYear: 1 });

TransactionSchema.statics.generateTransactionId = function () {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `TXN${timestamp}${random}`;
};

export default mongoose.models.Transaction ||
  mongoose.model("Transaction", TransactionSchema);

import mongoose from "mongoose";
const ReceiptSchema = new mongoose.Schema(
  {
    receiptNo: { type: String, required: true, unique: true },
    unitClass: { type: String, enum: ["Shop", "Office", null], default: null },
    billSeries: { type: String, enum: ["RESIDENTIAL", "COMMERCIAL"], default: "RESIDENTIAL" },
    filename: { type: String, required: true },
    billId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bill",
      required: true,
    },
    billPeriodId: { type: String, required: true },
    // A COMMERCIAL receipt belongs to a SHOP, and a shop may be owned by a
    // non-resident who has no Member record at all. `required: true` therefore
    // made it impossible to record a payment against a commercial bill — the
    // same reason models/Bill.js already makes memberId conditional. The rule is
    // mirrored here rather than relaxed: residential receipts still must name a
    // member.
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Member",
      required: function () {
        return this.billSeries !== "COMMERCIAL";
      },
      default: null,
      index: true,
    },
    // Mirrors Bill.shopId / Transaction.shopId so a shop's payment history can
    // be read without going through a member.
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      default: null,
      index: true,
    },
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    amount: { type: Number, required: true },
    amountReceived: { type: Number, default: 0 },
    amountApplied: { type: Number, default: 0 },
    interestApplied: { type: Number, default: 0 },
    principalApplied: { type: Number, default: 0 },
    advanceCreditCreated: { type: Number, default: 0 },
    remainingBalance: { type: Number, default: 0 },
    settlementStatus: { type: String, enum: ["Paid", "Partial"], default: "Paid" },
    previousBalanceSnapshot: { type: Number, default: 0 },
    paymentMode: { type: String, default: "Online" },
    paidAt: { type: Date, default: Date.now },
    transactionId: { type: String },
    notes: { type: String },
    status: {
      type: String,
      enum: ["Generated", "Downloaded"],
      default: "Generated",
    },
  },
  { timestamps: true },
);
ReceiptSchema.index({ memberId: 1, societyId: 1, paidAt: -1 });
// The commercial equivalent: "this shop's receipts, newest first".
ReceiptSchema.index({ shopId: 1, societyId: 1, paidAt: -1 });
export default mongoose.models.Receipt ||
  mongoose.model("Receipt", ReceiptSchema);

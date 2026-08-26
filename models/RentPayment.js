import mongoose from "mongoose";
// Mirrors mobile-backend's RentPayment collection. Record-keeping only —
// "Online" is accepted as a paymentMode value with no gateway behind it yet.
const RentPaymentSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: "Member", required: true, index: true },
    recordedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    month: { type: String, required: true },
    amount: { type: Number, required: true },
    paymentMode: { type: String, enum: ["Cash", "UPI", "BankTransfer", "Cheque", "Online"], required: true },
    paidAt: { type: Date, required: true },
    notes: String,
    // Tenant-submitted payments start Pending and only the owner confirms them.
    status: { type: String, enum: ["Pending", "Confirmed", "Rejected"], default: "Confirmed", index: true },
    submittedByRole: { type: String, enum: ["Owner", "Tenant"], default: "Owner" },
    confirmedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    confirmedAt: Date,
    rejectionReason: String,
    reference: String,
    // LOOP-03: append-only edit trail. Every field mutation via PATCH pushes
    // the prior values here before applying the change, so a disputed rent
    // figure has a record of what it used to be.
    editHistory: [
      {
        editedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        editedAt: { type: Date, default: Date.now },
        previous: mongoose.Schema.Types.Mixed,
      },
    ],
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: Date,
    deletedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
export default mongoose.models.RentPayment || mongoose.model("RentPayment", RentPaymentSchema);
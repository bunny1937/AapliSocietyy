import mongoose from "mongoose";

// Society expenditure — the outflow side that the Balance Sheet was missing.
// Kept deliberately simple: one row per real-world payment the society makes
// (salary, repairs, electricity, audit fees, etc.). Income stays on Bill;
// this is the counterpart so net position = collected − spent.
const ExpenseSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    category: {
      type: String,
      required: true,
      enum: [
        "Salary",
        "Security",
        "Housekeeping",
        "Repairs & Maintenance",
        "Electricity",
        "Water",
        "Lift/Elevator",
        "Garden",
        "Legal & Professional",
        "Audit",
        "Insurance",
        "Property Tax",
        "Bank Charges",
        "Festival & Events",
        "Miscellaneous",
      ],
      index: true,
    },
    amount: { type: Number, required: true, min: 0 },
    // Human-facing date the money went out.
    date: { type: Date, required: true, index: true },
    // Denormalised "YYYY-MM" so the balance-sheet can bucket without date math.
    periodId: { type: String, required: true, index: true },
    paymentMethod: {
      type: String,
      enum: ["Cash", "Cheque", "Online", "NEFT", "UPI", "Card", "Other"],
      default: "Online",
    },
    vendor: { type: String, trim: true, maxlength: 160 },
    referenceNo: { type: String, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 1000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdByName: { type: String, trim: true },
    // The double-entry voucher this expense was posted as, when it reached
    // the books at all. Null with a reason beside it is a normal state: a
    // society mid-setup records expenses long before its books can accept
    // them, and refusing the expense would be the wrong trade.
    // See lib/accounting/expenseBridge.js.
    voucherId: { type: mongoose.Schema.Types.ObjectId, ref: "Voucher", default: null },
    postedToBooksAt: { type: Date, default: null },
    notPostedReason: { type: String, trim: true, default: null },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

// Main feed + balance-sheet aggregation query.
ExpenseSchema.index({ societyId: 1, isDeleted: 1, date: -1 });
ExpenseSchema.index({ societyId: 1, periodId: 1, isDeleted: 1 });

export default mongoose.models.Expense || mongoose.model("Expense", ExpenseSchema);

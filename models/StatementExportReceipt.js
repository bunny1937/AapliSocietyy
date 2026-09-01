/**
 * StatementExportReceipt — a hash-stamped, timestamped record that a
 * statutory statement was exported, and what it said at that moment.
 *
 * Not a stored PDF. The export itself is still the browser's own
 * window.print() (see PrintArea usage in generate-statements/PageClient.js)
 * — this only records the fact and the figures, so a hash printed on the
 * PDF can later be checked against this row: if the books get corrected
 * next month, this receipt still proves what the statement said the day
 * the auditor was handed it.
 */
import mongoose from "mongoose";

const StatementExportReceiptSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    financialYearId: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialYear", required: true },
    financialYearLabel: { type: String, default: "" },
    hash: { type: String, required: true }, // sha256 of the canonical statement payload
    generatedAt: { type: Date, required: true },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    generatedByName: { type: String, default: "" },
    // Small, printable summary — not the full statement (that lives in the
    // ledger and is recomputed on demand); just enough to show what this
    // particular hash was taken over, for a human reading the receipt list.
    summary: {
      totalIncome: Number,
      totalExpenditure: Number,
      totalAssets: Number,
      totalLiabilities: Number,
      isBalanced: Boolean,
    },
  },
  { timestamps: true },
);

StatementExportReceiptSchema.index({ societyId: 1, financialYearId: 1, generatedAt: -1 });

export default mongoose.models.StatementExportReceipt ||
  mongoose.model("StatementExportReceipt", StatementExportReceiptSchema);

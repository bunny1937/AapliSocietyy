import mongoose from "mongoose";

// Phase 2.4 of the accounting-system revamp (docs/accounting-system-ARD.md
// §6.3, §8). The accounting backbone — every Journal Entry line references
// an account here. `type` is the standard 5-way double-entry classification
// (drives which side a debit/credit increases); `subType` is the finer
// category used for grouping in the UI and by the sub-registers (Asset
// Register, Liability Register, Fund Management) without those registers
// needing their own duplicate "type of thing" field.
const TYPES = ["Asset", "Liability", "Income", "Expense", "Equity"];
const SUB_TYPES = [
  "Bank",
  "Cash",
  "Receivable",
  "FixedAsset",
  "Investment",
  "Payable",
  "Loan",
  "StatutoryLiability",
  "ReserveFund",
  "SinkingFund",
  "RepairFund",
  "CorpusFund",
  "ShareCapital",
  "GeneralFund",
  "RetainedSurplus",
  "Income",
  "Expense",
  "Other",
];
// Which side of a Journal Entry increases this account's balance — standard
// double-entry rule, not configurable per-account (it follows from `type`).
const NORMAL_BALANCE_BY_TYPE = {
  Asset: "Debit",
  Expense: "Debit",
  Liability: "Credit",
  Income: "Credit",
  Equity: "Credit",
};

const ChartOfAccountSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: TYPES, required: true },
    subType: { type: String, enum: SUB_TYPES, default: "Other" },
    // scheduleCode ties this account to a Balance Sheet schedule (Schedule A
    // Share Capital, B Reserve Fund, etc. — §6.3). Left null until Phase
    // 2.18's Financial Statements module needs it; the Validation Engine
    // (Phase 2.16) flags Posted-status accounts with none set.
    scheduleCode: { type: String, default: null, trim: true },
    parentAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    normalBalance: { type: String, enum: ["Debit", "Credit"] }, // set from `type` in pre-validate, not caller-supplied
    isActive: { type: Boolean, default: true },
    isLocked: { type: Boolean, default: false }, // locked accounts can't be edited/deactivated, only referenced
    isSystemAccount: { type: Boolean, default: false }, // seeded by defaults, protected from deletion
    description: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

ChartOfAccountSchema.index({ societyId: 1, code: 1 }, { unique: true });
ChartOfAccountSchema.index({ societyId: 1, type: 1, isActive: 1 });

ChartOfAccountSchema.pre("validate", function (next) {
  this.normalBalance = NORMAL_BALANCE_BY_TYPE[this.type];
  next();
});

ChartOfAccountSchema.statics.TYPES = TYPES;
ChartOfAccountSchema.statics.SUB_TYPES = SUB_TYPES;
ChartOfAccountSchema.statics.NORMAL_BALANCE_BY_TYPE = NORMAL_BALANCE_BY_TYPE;

export default mongoose.models.ChartOfAccount ||
  mongoose.model("ChartOfAccount", ChartOfAccountSchema);

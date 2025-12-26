import mongoose from "mongoose";

const SocietySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    registrationNo: {
      type: String,
      unique: true,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
    },
    billTemplate: {
      type: { type: String, enum: ["default", "uploaded"], default: "default" },
      fileName: { type: String },
      filePath: { type: String },
      uploadedAt: { type: Date },
      uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    config: {
      maintenanceRate: { type: Number, default: 0 },
      sinkingFundRate: { type: Number, default: 0 },
      repairFundRate: { type: Number, default: 0 },
      interestRate: { type: Number, default: 0 },
      serviceTaxRate: { type: Number, default: 0 },
      gracePeriodDays: { type: Number, default: 10 },
      billDueDay: { type: Number, default: 10, min: 1, max: 31 }, // Due date of month (e.g., 10th)
      interestCalculationMethod: {
        type: String,
        enum: ["SIMPLE", "COMPOUND"],
        default: "COMPOUND",
      },
      interestCompoundingFrequency: {
        type: String,
        enum: ["DAILY", "MONTHLY"],
        default: "MONTHLY",
      },
      fixedCharges: {
        water: { type: Number, default: 0 },
        security: { type: Number, default: 0 },
        electricity: { type: Number, default: 0 },
      },
    },
    matrixConfig: {
      L: { type: Number, default: 0 },
      R: { type: Number, default: 0 },
    },
    billingHeads: [
      {
        id: String,
        label: String,
      },
    ],
  },
  {
    timestamps: true,
  }
);

export default mongoose.models.Society ||
  mongoose.model("Society", SocietySchema);

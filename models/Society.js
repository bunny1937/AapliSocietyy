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
    config: {
      maintenanceRate: { type: Number, default: 0 },
      sinkingFundRate: { type: Number, default: 0 },
      repairFundRate: { type: Number, default: 0 },
      interestRate: { type: Number, default: 0 },
      serviceTaxRate: { type: Number, default: 0 },
      gracePeriodDays: { type: Number, default: 10 },
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

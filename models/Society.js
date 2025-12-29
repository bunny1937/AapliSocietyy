import mongoose from "mongoose";

const SocietySchema = new mongoose.Schema({
  // Basic Information
  name: { type: String, required: true, trim: true },
  registrationNo: { type: String, unique: true, trim: true, minlength: 4 },
  dateOfRegistration: { type: Date },
  address: { type: String, trim: true },
  panNo: { type: String, trim: true },
  tanNo: { type: String, trim: true },
  
  // Contact Details
  personOfContact: { type: String, trim: true },
  contactEmail: { type: String, trim: true },
  contactPhone: { type: String, trim: true },
  
  // Carpet Area (for total society premises in sqft)
  carpetAreaSqft: { type: Number, default: 0 },
  
  // ... rest of existing config

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
        enum: [ "MONTHLY"],
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

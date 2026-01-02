import mongoose from "mongoose";

const SocietySchema = new mongoose.Schema(
  {
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

    // Carpet Area
    carpetAreaSqft: { type: Number, default: 0 },

   // Bill Template - UPDATED STRUCTURE
  billTemplate: {
    type: {
      type: String,
      enum: ['default', 'custom', 'uploaded-pdf', 'uploaded-image'],
      default: 'default'
    },
    // For uploaded PDF
    pdfUrl: { type: String },
    hasFormFields: { type: Boolean, default: false },
    detectedFields: [{ type: String }],
    
    // For uploaded image
    imageUrl: { type: String },
    
    // For custom design
    design: {
      type: mongoose.Schema.Types.Mixed, 
      default: null,
      headerBg: String,
      headerColor: String,
      societyNameSize: Number,
      addressSize: Number,
      billTitleSize: Number,
      billTitleAlign: String,
      tableHeaderBg: String,
      tableHeaderColor: String,
      tableRowBg1: String,
      tableRowBg2: String,
      tableBorderColor: String,
      totalBg: String,
      totalColor: String,
      totalSize: Number,
      footerSize: Number,
      footerText: [String],
      showSignature: Boolean,
      signatureLabel: String
    },
    
    // Common assets
    logoUrl: { type: String },
    signatureUrl: { type: String },
    
    uploadedAt: { type: Date },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // OLD FIELDS - keep for backward compatibility
    fileName: { type: String },
    filePath: { type: String }
  },

    // Configuration
    config: {
      maintenanceRate: { type: Number, default: 0 },
      sinkingFundRate: { type: Number, default: 0 },
      repairFundRate: { type: Number, default: 0 },
      interestRate: { type: Number, default: 0 },
      serviceTaxRate: { type: Number, default: 0 },
      gracePeriodDays: { type: Number, default: 10 },
      billDueDay: { type: Number, default: 10, min: 1, max: 31 },
      interestCalculationMethod: {
        type: String,
        enum: ["SIMPLE", "COMPOUND"],
        default: "COMPOUND",
      },
      interestCompoundingFrequency: {
        type: String,
        enum: ["MONTHLY"],
        default: "MONTHLY",
      },
      fixedCharges: {
        water: { type: Number, default: 0 },
        security: { type: Number, default: 0 },
        electricity: { type: Number, default: 0 },
      },
    },

    // Subscription
    subscription: {
      planType: {
        type: String,
        enum: ["Free", "Basic", "Premium", "Enterprise"],
        default: "Free",
      },
      startDate: { type: Date, default: Date.now },
      lastPaymentDate: { type: Date },
      nextPaymentDate: { type: Date },
      amountPaid: { type: Number, default: 0 },
      status: {
        type: String,
        enum: ["Active", "Suspended", "Trial", "Expired"],
        default: "Trial",
      },
      paymentHistory: [
        {
          date: { type: Date, required: true },
          amount: { type: Number, required: true },
          transactionId: { type: String },
          method: { type: String },
        },
      ],
    },

    // Soft delete support
isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    deletionReason: { type: String },

    // Config versioning
    configVersion: { type: Number, default: 1 },

    // Matrix Config
    matrixConfig: {
      L: { type: Number, default: 0 },
      R: { type: Number, default: 0 },
    },

    // ❌ FIX #2: REMOVED billingHeads[] array
    // Use BillingHead model as SINGLE SOURCE OF TRUTH:
    // Query: BillingHead.find({ societyId })
  },
  {
    timestamps: true,
  }
);

// Pre-save hook
SocietySchema.pre("save", function (next) {
  if (this.isModified("config") || this.isModified("matrixConfig")) {
    this.configVersion += 1;
  }
  next();
});

// Indexes
SocietySchema.index({ isDeleted: 1 });
SocietySchema.index({ "subscription.status": 1 });

export default mongoose.models.Society ||
  mongoose.model("Society", SocietySchema);

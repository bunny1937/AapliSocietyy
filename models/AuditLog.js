import mongoose from "mongoose";

const AuditLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
   action: {
  type: String,
  required: true,
  enum: [
    'UPDATE_SOCIETY_CONFIG',
    'UPDATE_MATRIX_CONFIG',
    'GENERATE_BILLS',
    'RECORD_PAYMENT',
    'IMPORT_MEMBERS',
    'IMPORT_MEMBERS_ENHANCED',  // ← ADD THIS
    'UPDATE_MEMBER',
    'DELETE_MEMBER',
    'FINANCIAL_YEAR_CLOSE',
  ],
},

    oldData: {
      type: mongoose.Schema.Types.Mixed,
    },
    newData: {
      type: mongoose.Schema.Types.Mixed,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.models.AuditLog ||
  mongoose.model("AuditLog", AuditLogSchema);

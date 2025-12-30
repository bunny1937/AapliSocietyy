import mongoose from 'mongoose';

const AdminLogSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    adminName: {
      type: String,
      required: true,
    },
    action: {
      type: String,
      required: true,
      enum: [
        'LOGIN',
        'LOGOUT',
        'CREATE_SOCIETY',
        'DELETE_SOCIETY',
        'SUSPEND_SOCIETY',
        'ACTIVATE_SOCIETY',
        'VIEW_DATA',
        'EXPORT_DATA',
        'DELETE_DATA',
        'RESTORE_DATA',
        'UPDATE_CONFIG',
      ],
      index: true,
    },
    targetSociety: {
      societyId: mongoose.Schema.Types.ObjectId,
      societyName: String,
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
    },
    ipAddress: {
      type: String,
    },
    userAgent: {
      type: String,
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

// Index for querying
AdminLogSchema.index({ adminId: 1, timestamp: -1 });
AdminLogSchema.index({ action: 1, timestamp: -1 });

export default AdminLogSchema;

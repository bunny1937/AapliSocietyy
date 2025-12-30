import mongoose from 'mongoose';

const ExportSchema = new mongoose.Schema(
  {
    // What was deleted
    collectionName: {
      type: String,
      required: true,
      enum: ['bills', 'members', 'transactions', 'billingheads', 'societies'],
      index: true,
    },
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    societyName: {
      type: String,
      required: true,
    },

    // Deletion metadata
    deletedAt: {
      type: Date,
      default: Date.now,
    },
    deletedBy: {
      userId: mongoose.Schema.Types.ObjectId,
      userName: String,
      userRole: String,
    },
    deletionReason: {
      type: String,
      required: true,
    },

    // Export file info
    exportFile: {
      filename: String,
      filepath: String,
      filesize: Number, // in bytes
      format: {
        type: String,
        enum: ['excel', 'json', 'csv'],
        default: 'excel',
      },
    },

    // Deleted data (full copy)
    data: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },

    // Statistics
    recordCount: {
      type: Number,
      required: true,
    },
    totalValue: {
      type: Number, // For bills: sum of amounts
      default: 0,
    },

    // Restoration
    isRestored: {
      type: Boolean,
      default: false,
      index: true,
    },
    restoredAt: {
      type: Date,
    },
    restoredBy: {
      userId: mongoose.Schema.Types.ObjectId,
      userName: String,
    },

    // Auto-expire after 90 days
    willExpireAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// TTL index - MongoDB auto-deletes after expiry
ExportSchema.index({ willExpireAt: 1 }, { expireAfterSeconds: 0 });

// Compound indexes for queries
ExportSchema.index({ societyId: 1, collectionName: 1, deletedAt: -1 });
ExportSchema.index({ collectionName: 1, isRestored: 1 });

export default ExportSchema;

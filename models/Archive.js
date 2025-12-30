import mongoose from 'mongoose';

const ArchiveSchema = new mongoose.Schema({
  originalCollection: { 
    type: String, 
    required: true, 
    index: true,
    enum: ['bills', 'members', 'transactions', 'billingheads', 'societies']
  },
  originalId: { 
    type: mongoose.Schema.Types.ObjectId, 
    required: true, 
    index: true 
  },
  societyId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Society', 
    required: true, 
    index: true 
  },
  
  // Full document snapshot
  data: { 
    type: mongoose.Schema.Types.Mixed, 
    required: true 
  },
  
  // Deletion metadata
  deletedAt: { type: Date, default: Date.now, index: true },
  deletedBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  deletionReason: { type: String },
  
  // Restoration tracking
  isRestored: { type: Boolean, default: false },
  restoredAt: { type: Date },
  restoredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  // Auto-expire after 90 days
  willExpireAt: { type: Date }
  
}, { timestamps: true });

// TTL index for auto-deletion after 90 days
ArchiveSchema.index({ willExpireAt: 1 }, { expireAfterSeconds: 0 });

// Set expiry on creation
ArchiveSchema.pre('save', function(next) {
  if (this.isNew && !this.willExpireAt) {
    this.willExpireAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  }
  next();
});

export default mongoose.models.Archive || mongoose.model('Archive', ArchiveSchema);

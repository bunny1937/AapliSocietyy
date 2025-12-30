import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const SuperAdminSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      default: 'SuperAdmin',
      immutable: true, // Cannot change
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
    },
    loginHistory: [
      {
        timestamp: Date,
        ipAddress: String,
        userAgent: String,
      },
    ],
    permissions: {
      canDeleteSocieties: { type: Boolean, default: true },
      canModifyBilling: { type: Boolean, default: true },
      canAccessAllData: { type: Boolean, default: true },
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
SuperAdminSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password method
SuperAdminSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

export default SuperAdminSchema;

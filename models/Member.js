import mongoose from 'mongoose';

// Owner History Schema (embedded subdocument)
const OwnerHistorySchema = new mongoose.Schema({
  ownerName: { type: String, required: true, trim: true },
  panCard: { type: String, trim: true, uppercase: true },
  aadhaar: { type: String, trim: true },
  contactNumber: { type: String, required: true },
  emailPrimary: { type: String, trim: true, lowercase: true },
  
  // Ownership period
  ownershipStartDate: { type: Date, required: true },
  ownershipEndDate: { type: Date }, // null if current owner
  durationMonths: { type: Number }, // auto-calculated
  
  // Purchase/Sale details
  purchaseAmount: { type: Number },
  saleAmount: { type: Number },
  
  // Transfer details
  transferType: { 
    type: String, 
    enum: ['Purchase', 'Inheritance', 'Gift', 'Court Order', 'Other'],
    default: 'Purchase'
  },
  transferDate: { type: Date },
  registrationNumber: { type: String }, // Sale deed registration number
  
  // Why ownership ended
  exitReason: { 
    type: String,
    enum: ['Sold', 'Transferred', 'Deceased', 'Other']
  },
  
  isCurrent: { type: Boolean, default: false },
  
  // Notes
  notes: { type: String, trim: true }
  
}, { _id: true, timestamps: true });

// Tenant/Occupant History Schema (embedded subdocument)
const TenantHistorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  panCard: { type: String, trim: true },
  aadhaar: { type: String, trim: true },
  contactNumber: { type: String, required: true },
  email: { type: String, trim: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date }, // null if current tenant
  duration: { type: Number }, // in months, auto-calculated
  depositAmount: { type: Number, default: 0 },
  rentPerMonth: { type: Number, default: 0 },
  isCurrent: { type: Boolean, default: false },
  moveOutReason: { type: String, trim: true },
  emergencyContact: {
    name: { type: String },
    relation: { type: String },
    phone: { type: String }
  }
}, { _id: true, timestamps: true });

// Main Member Schema
const MemberSchema = new mongoose.Schema({
  // === FLAT MASTER DATA (Highest Level) ===
  
  // Flat Identification (VERY UNIQUE)
  flatNo: { 
    type: String, 
    required: true, 
    trim: true, 
    uppercase: true 
  },
  wing: { 
    type: String, 
    trim: true, 
    default: '', 
    uppercase: true 
  },
  floor: { 
    type: Number, 
    min: -3, // Basement levels
    max: 150 
  },
  
  // Flat Physical Details
  carpetAreaSqft: { 
    type: Number, 
    required: true, 
    min: 0 
  },
  builtUpAreaSqft: { type: Number, min: 0 },
  superBuiltUpAreaSqft: { type: Number, min: 0 },
  
  flatType: { 
    type: String, 
    enum: ['1BHK', '2BHK', '3BHK', '4BHK', '5BHK+', 'Studio', 'Penthouse', 'Shop', 'Office'],
    default: '2BHK'
  },
  
  parkingSlots: [{
    slotNumber: String,
    type: { type: String, enum: ['Covered', 'Open', 'Stilt'] },
    vehicleType: { type: String, enum: ['Two-Wheeler', 'Four-Wheeler'] }
  }],
  
  // Ownership Status
  ownershipType: { 
    type: String, 
    enum: ['Owner-Occupied', 'Rented', 'Vacant', 'Under-Dispute'],
    default: 'Owner-Occupied'
  },
  
  possessionDate: { type: Date },
  
  // === CURRENT OWNER DATA (from ownerHistory array - most recent) ===
  
  ownerName: { 
    type: String, 
    required: true, 
    trim: true 
  },
  
  // Primary Contact Information
  contactNumber: { 
    type: String, 
    trim: true,
    required: true
  },
  alternateContact: { type: String, trim: true },
  whatsappNumber: { type: String, trim: true },
  emailPrimary: { type: String, trim: true, lowercase: true },
  emailSecondary: { type: String, trim: true, lowercase: true },
  
  // Identity Documents
  panCard: { type: String, trim: true, uppercase: true },
  aadhaar: { type: String, trim: true },
  
  // Permanent Address (if different from flat address)
  permanentAddress: {
    line1: String,
    line2: String,
    city: String,
    state: String,
    pincode: String,
    country: { type: String, default: 'India' }
  },
  
  // Emergency Contact
  emergencyContact: {
    name: { type: String },
    relation: { type: String },
    phoneNumber: { type: String },
    address: { type: String }
  },
  
  // Family Members (residing in the flat)
  familyMembers: [{
    name: { type: String, required: true },
    relation: { type: String }, // Spouse, Son, Daughter, Parent, etc.
    age: { type: Number },
    contactNumber: { type: String },
    occupation: { type: String }
  }],
  
  // === OWNER HISTORY (Array of all owners - COMPLETE TIMELINE) ===
  
  ownerHistory: [OwnerHistorySchema],
  
  // === TENANT/OCCUPANT DATA (Array of Historical Records) ===
  
  currentTenant: TenantHistorySchema, // Current tenant if rented
  tenantHistory: [TenantHistorySchema], // All previous tenants
  
  // === FINANCIAL DATA ===
  
  openingBalance: { 
    type: Number, 
    default: 0 
  },
  
  securityDeposit: {
    amount: { type: Number, default: 0 },
    depositDate: { type: Date },
    refundDate: { type: Date },
    status: { 
      type: String, 
      enum: ['Pending', 'Deposited', 'Refunded', 'Adjusted'],
      default: 'Pending'
    }
  },
  
  // Special Charges/Discounts
  specialDiscount: {
    percentage: { type: Number, min: 0, max: 100, default: 0 },
    reason: { type: String },
    validUntil: { type: Date }
  },
  
  // === MEMBERSHIP STATUS ===
  
  membershipStatus: {
    type: String,
    enum: ['Active', 'Inactive', 'Suspended', 'Blocked', 'Exited'],
    default: 'Active'
  },
  
  membershipNumber: { 
    type: String, 
    unique: true, 
    sparse: true // Auto-generated
  },
  
  // Voting Rights
  hasVotingRights: { type: Boolean, default: true },
  
  // === BILLING PREFERENCES ===
  
  billingPreferences: {
    emailBill: { type: Boolean, default: true },
    whatsappBill: { type: Boolean, default: false },
    printedBill: { type: Boolean, default: false },
    billDeliveryDay: { type: Number, min: 1, max: 31 }
  },
  
  // === MAINTENANCE DUES CONFIG ===
  
  customMaintenanceConfig: {
    isCustom: { type: Boolean, default: false },
    customRatePerSqft: { type: Number },
    reason: { type: String }
  },
  
  // === NOTES & REMARKS ===
  
  internalNotes: { type: String, trim: true }, // Admin-only notes
  publicRemarks: { type: String, trim: true }, // Visible to member
  
  // === SYSTEM FIELDS ===
  
  societyId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Society', 
    required: true, 
    index: true 
  },
  
  createdBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },
  
  lastModifiedBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },
  
  isDeleted: { type: Boolean, default: false },
  
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
MemberSchema.index({ societyId: 1, flatNo: 1, wing: 1 }, { unique: true });
MemberSchema.index({ societyId: 1, membershipStatus: 1 });
MemberSchema.index({ societyId: 1, ownershipType: 1 });
MemberSchema.index({ panCard: 1 }, { sparse: true });
MemberSchema.index({ contactNumber: 1 });
MemberSchema.index({ emailPrimary: 1 }, { sparse: true });
MemberSchema.index({ isDeleted: 1 });

// Virtual for full flat identifier
MemberSchema.virtual('fullFlatId').get(function() {
  return this.wing ? `${this.wing}-${this.flatNo}` : this.flatNo;
});

// Virtual for current occupant name
MemberSchema.virtual('currentOccupantName').get(function() {
  if (this.ownershipType === 'Rented' && this.currentTenant) {
    return this.currentTenant.name;
  }
  return this.ownerName;
});

// Virtual to get current owner from history
MemberSchema.virtual('currentOwnerFromHistory').get(function() {
  const currentOwner = this.ownerHistory.find(owner => owner.isCurrent);
  return currentOwner || null;
});

// Pre-save middleware to auto-generate membership number
MemberSchema.pre('save', async function(next) {
  if (this.isNew && !this.membershipNumber) {
    try {
      // Get count of existing members in this society
      const count = await this.constructor.countDocuments({ 
        societyId: this.societyId 
      });
      
      // Generate unique number with timestamp to avoid collisions
      let nextNumber = count + 1;
      let attempts = 0;
      const maxAttempts = 10;
      
      while (attempts < maxAttempts) {
        this.membershipNumber = `MEM-${String(nextNumber).padStart(4, '0')}`;
        
        // Check if this number already exists
        const existing = await this.constructor.findOne({
          societyId: this.societyId,
          membershipNumber: this.membershipNumber
        });
        
        if (!existing) {
          break; // Found unique number
        }
        
        nextNumber++;
        attempts++;
      }
      
      if (attempts >= maxAttempts) {
        throw new Error('Failed to generate unique membership number');
      }
      
    } catch (error) {
      return next(error);
    }
  }
  
  // Calculate tenant duration if endDate is set
  if (this.currentTenant && this.currentTenant.endDate && this.currentTenant.startDate) {
    const months = Math.floor((this.currentTenant.endDate - this.currentTenant.startDate) / (1000 * 60 * 60 * 24 * 30));
    this.currentTenant.duration = months;
  }
  
  // Calculate owner duration for history entries
  this.ownerHistory.forEach(owner => {
    if (owner.ownershipEndDate && owner.ownershipStartDate) {
      const months = Math.floor((owner.ownershipEndDate - owner.ownershipStartDate) / (1000 * 60 * 60 * 24 * 30));
      owner.durationMonths = months;
    }
  });
  
  next();
});



// ========== METHODS ==========

// Method to transfer ownership to new owner
MemberSchema.methods.transferOwnership = function(newOwnerData, transferDetails) {
  // Move current owner to history
  if (this.ownerName) {
    const currentOwnerHistory = {
      ownerName: this.ownerName,
      panCard: this.panCard,
      aadhaar: this.aadhaar,
      contactNumber: this.contactNumber,
      emailPrimary: this.emailPrimary,
      ownershipStartDate: this.ownerHistory.length > 0 
        ? this.ownerHistory[this.ownerHistory.length - 1].ownershipEndDate || this.possessionDate
        : this.possessionDate,
      ownershipEndDate: transferDetails.transferDate || new Date(),
      isCurrent: false,
      ...transferDetails // includes purchaseAmount, saleAmount, exitReason, etc.
    };
    
    this.ownerHistory.push(currentOwnerHistory);
  }
  
  // Set new owner as current
  this.ownerName = newOwnerData.ownerName;
  this.panCard = newOwnerData.panCard;
  this.aadhaar = newOwnerData.aadhaar;
  this.contactNumber = newOwnerData.contactNumber;
  this.emailPrimary = newOwnerData.emailPrimary;
  
  // Add new owner to history as current
  this.ownerHistory.push({
    ...newOwnerData,
    ownershipStartDate: transferDetails.transferDate || new Date(),
    isCurrent: true
  });
};

// Method to move current tenant to history
MemberSchema.methods.moveCurrentTenantToHistory = function(moveOutReason) {
  if (this.currentTenant) {
    this.currentTenant.endDate = new Date();
    this.currentTenant.isCurrent = false;
    this.currentTenant.moveOutReason = moveOutReason;
    
    // Calculate duration
    const months = Math.floor((this.currentTenant.endDate - this.currentTenant.startDate) / (1000 * 60 * 60 * 24 * 30));
    this.currentTenant.duration = months;
    
    this.tenantHistory.push(this.currentTenant.toObject());
    this.currentTenant = null;
    this.ownershipType = 'Owner-Occupied';
  }
};

// Method to add new tenant
MemberSchema.methods.addNewTenant = function(tenantData) {
  // Move current tenant to history if exists
  if (this.currentTenant) {
    this.moveCurrentTenantToHistory('New tenant moved in');
  }
  
  this.currentTenant = {
    ...tenantData,
    isCurrent: true,
    startDate: tenantData.startDate || new Date()
  };
  this.ownershipType = 'Rented';
};

export default mongoose.models.Member || mongoose.model('Member', MemberSchema);

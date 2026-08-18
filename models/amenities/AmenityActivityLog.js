import mongoose from "mongoose";

// amenity_activity_logs — before/after audit trail for every mutation in the
// module.
//
// This is intentionally separate from the global AuditLog: amenity activity is
// read back per-amenity in the admin UI ("who changed the pool rules?"), and
// mixing it into the society-wide audit collection would make that a scan.
const AmenityActivityLogSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    // Which entity the change was made to.
    entityType: {
      type: String,
      required: true,
      enum: [
        "CATEGORY",
        "AMENITY",
        "RULE",
        "AVAILABILITY",
        "SLOT",
        "MAINTENANCE",
        "EVENT",
        "REGISTRATION",
        "WAITLIST",
        "ATTENDANCE",
        "VISITOR",
        "QR",
        "INCIDENT",
        "SETTINGS",
        "MEMBER_CARD",
      ],
      index: true,
    },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    // Denormalised so a log line still reads sensibly after the amenity is
    // renamed or deleted.
    amenityId: { type: mongoose.Schema.Types.ObjectId, ref: "Amenity", default: null, index: true },
    amenityName: { type: String, default: "" },
    action: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    userName: { type: String, default: "" },
    userRole: { type: String, default: "" },
    // Only the fields that actually changed, not whole documents: a full
    // before/after of every amenity write would dominate storage.
    changedFields: { type: [String], default: [] },
    oldValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null },
    note: { type: String, trim: true, maxlength: 500 },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false },
);

AmenityActivityLogSchema.index({ societyId: 1, at: -1 });
AmenityActivityLogSchema.index({ societyId: 1, amenityId: 1, at: -1 });
AmenityActivityLogSchema.index({ societyId: 1, entityType: 1, action: 1, at: -1 });

export default mongoose.models.AmenityActivityLog ||
  mongoose.model("AmenityActivityLog", AmenityActivityLogSchema, "amenity_activity_logs");

import mongoose from "mongoose";
const NotificationSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdByName: { type: String, default: "System" },
    type: {
      type: String,
      required: true,
      enum: [
        // ── existing ──
        "BILL_GENERATED",
        "PAYMENT_RECEIVED",
        "PAYMENT_FAILED",
        "DUE_REMINDER",
        "NOTICE_POSTED",
        "COMPLAINT_APPROVED",
        "COMPLAINT_REJECTED",
        "MAINTENANCE_ALERT",
        "ADMIN_MESSAGE",
        "CUSTOM",
        // ── amenities ──
        "AMENITY_MAINTENANCE_SCHEDULED",
        "AMENITY_MAINTENANCE_UPDATED",
        "AMENITY_MAINTENANCE_EXTENDED",
        "AMENITY_REOPENED",
        "AMENITY_CLOSED",
        "AMENITY_EMERGENCY_CLOSURE",
        "AMENITY_RULES_UPDATED",
        "AMENITY_EVENT_CREATED",
        "AMENITY_EVENT_UPDATED",
        "AMENITY_EVENT_CANCELLED",
        "AMENITY_EVENT_REMINDER",
        "AMENITY_WAITLIST_PROMOTED",
        "AMENITY_INCIDENT_REPORTED",
        "AMENITY_INCIDENT_RESOLVED",
        "AMENITY_VISITOR_APPROVAL_REQUIRED",
        "AMENITY_CHECKIN_REJECTED",
        // ── visitor management ──
        "VISITOR_APPROVAL", // resident: someone is at the gate, approve/deny
        "VISITOR_DECISION", // guard: resident approved/denied
        "VISITOR_ENTERED", // resident: visitor has entered
        "VISITOR_EXITED", // resident: visitor has left
        "VISITOR_ESCALATION", // resident/admin: approval is being escalated
        "VISITOR_PASS", // resident: a pass was used
        "VISITOR_SOS", // everyone: panic/SOS raised
        "SECURITY_ALERT", // admin: contact unreachable / watchlist hit
        // ── tenant onboarding ──
        "TENANT_REQUEST_APPROVED", // owner: their tenant request was approved
        "TENANT_REQUEST_REJECTED", // owner: their tenant request was rejected
        // ── profile edit requests ──
        "PROFILE_EDIT_REQUEST_APPROVED", // owner: their Contact/Family/EmergencyContact change was approved
        "PROFILE_EDIT_REQUEST_REJECTED",
        // ── society shops (commercial) ──
        // These are required, not cosmetic: models/Notification.js validates
        // `type` against this enum, and lib/visitor-channels.js#sendInApp
        // swallows its own errors. A missing value would mean the shop never
        // hears about a new order and nobody would see an error anywhere.
        "SHOP_PROFILE_ADDED",   // resident: a shop was linked to their account
        "SHOP_ORDER_PLACED",    // shop owner: a resident placed an order
        "SHOP_ORDER_UPDATED",   // resident: their order moved (accepted/ready/…)
        "SHOP_ORDER_CANCELLED", // shop owner: the resident cancelled // owner: their Contact/Family/EmergencyContact change was rejected
      ],
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    message: { type: String, required: true, trim: true, maxlength: 500 },
    priority: {
      type: String,
      enum: ["normal", "high", "critical"],
      default: "normal",
      index: true,
    },
    // Targeting
    recipientType: {
      type: String,
      required: true,
      enum: ["all", "member", "wing", "flats", "role", "user"],
    },
    // member:[memberId] · wing:[wingName] · flats:[memberId] · role:[roleName] · user:[userId]
    recipientIds: [{ type: String }],
    // "owner" | "tenant" | "all" — narrows a flat-scoped notification to one
    // occupant so tenants stop receiving the owner's visitor//rent alerts.
    audience: { type: String, enum: ["owner", "tenant", "all"], default: "all" },
    // Arbitrary structured payload (visitorId, photo, flatNo, action, …)
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    readBy: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        readAt: { type: Date, default: Date.now },
      },
    ],
    actionUrl: { type: String, default: null },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);
NotificationSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, sparse: true },
);
NotificationSchema.index({ societyId: 1, isDeleted: 1, createdAt: -1 });
NotificationSchema.index({ societyId: 1, recipientType: 1, createdAt: -1 });
export default mongoose.models.Notification ||
  mongoose.model("Notification", NotificationSchema);

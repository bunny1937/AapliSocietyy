// Ported from @aapli/constants (mobile-backend shared-constants package).
// Single source of truth for roles, statuses, notification types, and socket
// room names used across the /v1 (mobile) API layer.

export const ROLES = {
  SUPER_ADMIN: "SuperAdmin",
  ADMIN: "Admin",
  SECRETARY: "Secretary",
  ACCOUNTANT: "Accountant",
  AUDITOR: "Auditor",
  SECURITY: "Security",
  MEMBER: "Member",
};

export const SOCIETY_ADMIN_ROLES = [ROLES.ADMIN, ROLES.SECRETARY];
export const BILLING_WRITE_ROLES = [ROLES.ADMIN, ROLES.SECRETARY];
export const VISITOR_ACCESS_ROLES = [ROLES.ADMIN, ROLES.SECRETARY, ROLES.SECURITY];

export const OCCUPANCY_TYPES = { OWNER: "Owner", TENANT: "Tenant" };

export const BILL_STATUS = {
  SCHEDULED: "Scheduled",
  UNPAID: "Unpaid",
  PARTIAL: "Partial",
  PAID: "Paid",
  OVERDUE: "Overdue",
};

export const VISITOR_STATUS = {
  PENDING: "Pending",
  APPROVED: "Approved",
  ENTERED: "Entered",
  EXITED: "Exited",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
};

export const NOTIFICATION_TYPES = {
  BILL_GENERATED: "BILL_GENERATED",
  PAYMENT_RECEIVED: "PAYMENT_RECEIVED",
  NOTICE_POSTED: "NOTICE_POSTED",
  COMPLAINT_APPROVED: "COMPLAINT_APPROVED",
  COMPLAINT_REJECTED: "COMPLAINT_REJECTED",
  VISITOR_APPROVAL: "VISITOR_APPROVAL",
  VISITOR_DECISION: "VISITOR_DECISION",
  VISITOR_ENTERED: "VISITOR_ENTERED",
  VISITOR_EXITED: "VISITOR_EXITED",
  VISITOR_ESCALATION: "VISITOR_ESCALATION",
  VISITOR_PASS: "VISITOR_PASS",
  VISITOR_SOS: "VISITOR_SOS",
  SECURITY_ALERT: "SECURITY_ALERT",
  TENANT_LEASE_EXPIRED: "TENANT_LEASE_EXPIRED",
  GUARD_MESSAGE: "GUARD_MESSAGE",
  VISITOR_REASSIGNED: "VISITOR_REASSIGNED",
  // Tenant <-> owner message thread on a tenancy.
  TENANT_NOTE: "TENANT_NOTE",
  // Someone has acknowledged an SOS: the signal that stops the alarm on every
  // device in the flat, not just the phone the acknowledger is holding.
  VISITOR_SOS_ACK: "VISITOR_SOS_ACK",

  // ── amenities ──
  // Amenity notifications deliberately reuse this shared collection rather than
  // a parallel amenity_notifications table, so residents get one unread badge
  // and one read-state model. metadata carries { amenityId, eventId }.
  AMENITY_MAINTENANCE_SCHEDULED: "AMENITY_MAINTENANCE_SCHEDULED",
  AMENITY_MAINTENANCE_UPDATED: "AMENITY_MAINTENANCE_UPDATED",
  AMENITY_MAINTENANCE_EXTENDED: "AMENITY_MAINTENANCE_EXTENDED",
  AMENITY_REOPENED: "AMENITY_REOPENED",
  AMENITY_CLOSED: "AMENITY_CLOSED",
  AMENITY_EMERGENCY_CLOSURE: "AMENITY_EMERGENCY_CLOSURE",
  AMENITY_RULES_UPDATED: "AMENITY_RULES_UPDATED",
  AMENITY_EVENT_CREATED: "AMENITY_EVENT_CREATED",
  AMENITY_EVENT_UPDATED: "AMENITY_EVENT_UPDATED",
  AMENITY_EVENT_CANCELLED: "AMENITY_EVENT_CANCELLED",
  AMENITY_EVENT_REMINDER: "AMENITY_EVENT_REMINDER",
  AMENITY_WAITLIST_PROMOTED: "AMENITY_WAITLIST_PROMOTED",
  AMENITY_INCIDENT_REPORTED: "AMENITY_INCIDENT_REPORTED",
  AMENITY_INCIDENT_RESOLVED: "AMENITY_INCIDENT_RESOLVED",
  AMENITY_VISITOR_APPROVAL_REQUIRED: "AMENITY_VISITOR_APPROVAL_REQUIRED",
  AMENITY_CHECKIN_REJECTED: "AMENITY_CHECKIN_REJECTED",
  // Sent to the resident AFTER a Clubhouse Manager's scan-and-check-in has
  // actually been recorded — never on the scan itself, so a refused or failed
  // check-in can't produce a notification for a visit that did not happen.
  AMENITY_CHECKED_IN: "AMENITY_CHECKED_IN",
  AMENITY_CHECKED_OUT: "AMENITY_CHECKED_OUT",
};

export const RECIPIENT_TYPES = ["all", "member", "wing", "flats", "role", "user"];
export const DELIVERY_CHANNELS = ["in_app", "push", "sms", "whatsapp", "email", "guard_call", "admin_alert"];

// Retained for parity/documentation. In the Vercel deployment there is no
// Socket.IO server, so these room names are no longer used to emit realtime
// events; the Flutter client polls instead (see V1_MIGRATION.md).
export const room = {
  society: (societyId) => `society_${societyId}`,
  member: (memberId) => `member_${memberId}`,
  security: (societyId) => `security_${societyId}`,
  user: (userId) => `user_${userId}`,
  wing: (societyId, wing) => `wing_${societyId}_${wing}`,
};

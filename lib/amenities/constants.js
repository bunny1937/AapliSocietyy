// Single source of truth for the Amenities module vocabulary.
//
// Nothing in this file describes a *specific* society's amenities: societies
// author their own categories, amenities, rules and slots at runtime. What is
// enumerated here are the state machines and capability switches the code
// itself branches on, which is the only class of value that must not be
// free-form (a typo in a status would silently break every filter).

export const AMENITY_STATUS = {
  OPEN: "OPEN",
  CLOSED: "CLOSED",
  UNDER_MAINTENANCE: "UNDER_MAINTENANCE",
  TEMPORARILY_CLOSED: "TEMPORARILY_CLOSED",
  PERMANENTLY_CLOSED: "PERMANENTLY_CLOSED",
};
export const AMENITY_STATUSES = Object.values(AMENITY_STATUS);

// Statuses in which a resident may not check in, no matter what the clock says.
export const NON_USABLE_STATUSES = [
  AMENITY_STATUS.CLOSED,
  AMENITY_STATUS.UNDER_MAINTENANCE,
  AMENITY_STATUS.TEMPORARILY_CLOSED,
  AMENITY_STATUS.PERMANENTLY_CLOSED,
];

export const ATTENDANCE_MODE = {
  NONE: "NONE",
  MANUAL: "MANUAL",
  QR: "QR",
  QR_MANUAL: "QR_MANUAL", // QR with a manual override for guards/admins
};
export const ATTENDANCE_MODES = Object.values(ATTENDANCE_MODE);

export const CHECKIN_METHOD = { QR: "QR", MANUAL: "MANUAL", OVERRIDE: "OVERRIDE" };
export const CHECKIN_METHODS = Object.values(CHECKIN_METHOD);

export const ATTENDEE_TYPE = { RESIDENT: "RESIDENT", VISITOR: "VISITOR", STAFF: "STAFF" };
export const ATTENDEE_TYPES = Object.values(ATTENDEE_TYPE);

// Who is allowed to use an amenity. CUSTOM defers to amenity.access.customRoles,
// which is how a society adds "Committee", "Trustee", "Domestic Help" or any
// role we have never heard of without a schema change.
export const ACCESS_AUDIENCE = {
  EVERYONE: "EVERYONE",
  OWNERS: "OWNERS",
  TENANTS: "TENANTS",
  STAFF: "STAFF",
  COMMITTEE: "COMMITTEE",
  CUSTOM: "CUSTOM",
};
export const ACCESS_AUDIENCES = Object.values(ACCESS_AUDIENCE);

export const RULE_KIND = {
  RULE: "RULE",
  DO: "DO",
  DONT: "DONT",
  INSTRUCTION: "INSTRUCTION",
};
export const RULE_KINDS = Object.values(RULE_KIND);

export const CLOSURE_TYPE = { HOLIDAY: "HOLIDAY", TEMPORARY: "TEMPORARY" };
export const CLOSURE_TYPES = Object.values(CLOSURE_TYPE);

export const MAINTENANCE_STATUS = {
  SCHEDULED: "SCHEDULED",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
};
export const MAINTENANCE_STATUSES = Object.values(MAINTENANCE_STATUS);

export const EVENT_STATUS = {
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  CANCELLED: "CANCELLED",
  COMPLETED: "COMPLETED",
};
export const EVENT_STATUSES = Object.values(EVENT_STATUS);

export const REGISTRATION_STATUS = {
  CONFIRMED: "CONFIRMED",
  CANCELLED: "CANCELLED",
  ATTENDED: "ATTENDED",
  NO_SHOW: "NO_SHOW",
};
export const REGISTRATION_STATUSES = Object.values(REGISTRATION_STATUS);

export const WAITLIST_STATUS = {
  WAITING: "WAITING",
  PROMOTED: "PROMOTED",
  LEFT: "LEFT",
  EXPIRED: "EXPIRED",
};
export const WAITLIST_STATUSES = Object.values(WAITLIST_STATUS);

// Waitlists are deliberately generic: today only events fill up, but slot and
// booking waitlists are on the roadmap, and a scope discriminator now means no
// migration then.
export const WAITLIST_SCOPE = { EVENT: "EVENT", SLOT: "SLOT", AMENITY: "AMENITY" };
export const WAITLIST_SCOPES = Object.values(WAITLIST_SCOPE);

// Incident types are seeded, not hardcoded: societies may add their own via
// settings.incidentTypes. These are the defaults offered on first use.
export const DEFAULT_INCIDENT_TYPES = [
  "Damage",
  "Cleaning Issue",
  "Equipment Failure",
  "Safety Hazard",
  "Rule Violation",
  "Noise Complaint",
  "Lost & Found",
  "Other",
];

export const INCIDENT_SEVERITY = { LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH", CRITICAL: "CRITICAL" };
export const INCIDENT_SEVERITIES = Object.values(INCIDENT_SEVERITY);

export const INCIDENT_STATUS = {
  OPEN: "OPEN",
  ACKNOWLEDGED: "ACKNOWLEDGED",
  IN_PROGRESS: "IN_PROGRESS",
  RESOLVED: "RESOLVED",
  CLOSED: "CLOSED",
  REJECTED: "REJECTED",
};
export const INCIDENT_STATUSES = Object.values(INCIDENT_STATUS);

// Every mutating action writes one of these into amenity_activity_logs.
export const ACTIVITY_ACTION = {
  CATEGORY_CREATED: "CATEGORY_CREATED",
  CATEGORY_UPDATED: "CATEGORY_UPDATED",
  CATEGORY_DELETED: "CATEGORY_DELETED",
  AMENITY_CREATED: "AMENITY_CREATED",
  AMENITY_UPDATED: "AMENITY_UPDATED",
  AMENITY_DELETED: "AMENITY_DELETED",
  AMENITY_STATUS_CHANGED: "AMENITY_STATUS_CHANGED",
  RULES_UPDATED: "RULES_UPDATED",
  AVAILABILITY_UPDATED: "AVAILABILITY_UPDATED",
  SLOTS_REGENERATED: "SLOTS_REGENERATED",
  CAPACITY_UPDATED: "CAPACITY_UPDATED",
  MAINTENANCE_SCHEDULED: "MAINTENANCE_SCHEDULED",
  MAINTENANCE_UPDATED: "MAINTENANCE_UPDATED",
  MAINTENANCE_EXTENDED: "MAINTENANCE_EXTENDED",
  MAINTENANCE_COMPLETED: "MAINTENANCE_COMPLETED",
  MAINTENANCE_CANCELLED: "MAINTENANCE_CANCELLED",
  QR_GENERATED: "QR_GENERATED",
  QR_REVOKED: "QR_REVOKED",
  ATTENDANCE_CHECK_IN: "ATTENDANCE_CHECK_IN",
  ATTENDANCE_CHECK_OUT: "ATTENDANCE_CHECK_OUT",
  ATTENDANCE_AUTO_CLOSED: "ATTENDANCE_AUTO_CLOSED",
  ATTENDANCE_UPDATED: "ATTENDANCE_UPDATED",
  EVENT_CREATED: "EVENT_CREATED",
  EVENT_UPDATED: "EVENT_UPDATED",
  EVENT_CANCELLED: "EVENT_CANCELLED",
  EVENT_REGISTERED: "EVENT_REGISTERED",
  EVENT_REGISTRATION_CANCELLED: "EVENT_REGISTRATION_CANCELLED",
  REGISTRATION_UPDATED: "REGISTRATION_UPDATED",
  WAITLIST_JOINED: "WAITLIST_JOINED",
  WAITLIST_LEFT: "WAITLIST_LEFT",
  WAITLIST_PROMOTED: "WAITLIST_PROMOTED",
  INCIDENT_REPORTED: "INCIDENT_REPORTED",
  INCIDENT_UPDATED: "INCIDENT_UPDATED",
  INCIDENT_RESOLVED: "INCIDENT_RESOLVED",
  SETTINGS_UPDATED: "SETTINGS_UPDATED",
  // Resident amenity card (the Clubhouse Manager scan credential). Issuing is
  // logged because a card is a bearer credential for entering an amenity, and
  // revocation is logged because it is the only way one stops working.
  MEMBER_CARD_ISSUED: "MEMBER_CARD_ISSUED",
  MEMBER_CARD_REVOKED: "MEMBER_CARD_REVOKED",
};

// Notification types added to the shared Notification enum by this module.
export const AMENITY_NOTIFICATION_TYPES = {
  AMENITY_MAINTENANCE_SCHEDULED: "AMENITY_MAINTENANCE_SCHEDULED",
  AMENITY_MAINTENANCE_UPDATED: "AMENITY_MAINTENANCE_UPDATED",
  AMENITY_MAINTENANCE_EXTENDED: "AMENITY_MAINTENANCE_EXTENDED",
  AMENITY_REOPENED: "AMENITY_REOPENED",
  AMENITY_STATUS_CHANGED: "AMENITY_STATUS_CHANGED",
  AMENITY_EMERGENCY_CLOSURE: "AMENITY_EMERGENCY_CLOSURE",
  AMENITY_RULES_UPDATED: "AMENITY_RULES_UPDATED",
  AMENITY_EVENT_CREATED: "AMENITY_EVENT_CREATED",
  AMENITY_EVENT_UPDATED: "AMENITY_EVENT_UPDATED",
  AMENITY_EVENT_CANCELLED: "AMENITY_EVENT_CANCELLED",
  AMENITY_EVENT_REMINDER: "AMENITY_EVENT_REMINDER",
  AMENITY_WAITLIST_PROMOTED: "AMENITY_WAITLIST_PROMOTED",
  AMENITY_INCIDENT_REPORTED: "AMENITY_INCIDENT_REPORTED",
  AMENITY_INCIDENT_RESOLVED: "AMENITY_INCIDENT_RESOLVED",
};

// ---------------------------------------------------------------------------
// Feature flags.
//
// The brief lists a long tail of deferred capabilities (bookings, payments,
// deposits, IoT, dynamic QR ...). They are modelled here as society-level
// switches that default to false so the schema and service seams exist from
// day one and turning one on is a settings write, not a release.
// ---------------------------------------------------------------------------
export const FEATURE_FLAGS = {
  // Shipping now
  categories: true,
  amenities: true,
  rules: true,
  availability: true,
  timeSlots: true,
  capacityLimits: true,
  maintenance: true,
  visitorAccess: true,
  attendance: true,
  qrCheckIn: true,
  events: true,
  waitlists: true,
  analytics: true,
  incidents: true,
  activityLog: true,
  // Deferred (architecture-ready, off by default)
  bookings: false,
  bookingApprovals: false,
  bookingCancellationPolicy: false,
  onlinePayments: false,
  securityDeposits: false,
  refunds: false,
  penalties: false,
  equipmentRentals: false,
  consumableInventory: false,
  recurringReservations: false,
  occupancyPrediction: false,
  iotIntegration: false,
  dynamicQrRotation: false,
  geofencedCheckIn: false,
  faceRecognition: false,
  digitalWaiver: false,
  billingIntegration: false,
  loyaltyPoints: false,
  calendarSync: false,
  publicApi: false,
};

export const DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6]; // 0 = Sunday, matches Date#getDay
export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Flat list of togglable flag names, e.g. for validating a settings PATCH body
// against "did the client send a flag we don't recognise".
export const FEATURE_FLAG_KEYS = Object.keys(FEATURE_FLAGS);

// Numeric ordering for sorting/comparing incidents by severity.
export const SEVERITY_RANK = {
  [INCIDENT_SEVERITY.LOW]: 1,
  [INCIDENT_SEVERITY.MEDIUM]: 2,
  [INCIDENT_SEVERITY.HIGH]: 3,
  [INCIDENT_SEVERITY.CRITICAL]: 4,
};

// STATIC: one QR printed and stuck at the amenity, valid until revoked.
// DYNAMIC: rotates every rotationIntervalMins so a photographed code goes stale.
export const QR_MODE = { STATIC: "STATIC", DYNAMIC: "DYNAMIC" };
export const QR_MODES = Object.values(QR_MODE);

export const QR_RESULT = {
  VALID: "VALID",
  INVALID_TOKEN: "INVALID_TOKEN",
  WRONG_SOCIETY: "WRONG_SOCIETY",
  REVOKED: "REVOKED",
  EXPIRED: "EXPIRED",
};

// ---------------------------------------------------------------------------
// Resident amenity card.
//
// A separate vocabulary from QR_MODE/QR_RESULT above on purpose: those describe
// the sticker printed ON an amenity, this describes the credential belonging to
// a PERSON. The two are validated by different services and must never be
// interchangeable — a card is not an amenity and an amenity is not a card.
//
// Cards are permanent: there is no EXPIRED state and no rotation. The only way
// a card stops working is an Admin revoking it, which is why REVOKED is the
// single non-ACTIVE status.
// ---------------------------------------------------------------------------
export const MEMBER_CARD_STATUS = { ACTIVE: "ACTIVE", REVOKED: "REVOKED" };
export const MEMBER_CARD_STATUSES = Object.values(MEMBER_CARD_STATUS);

// Who the card belongs to inside a flat. OWNER is the Member record's own
// owner identity; FAMILY is one entry of Member.familyMembers[]. No third kind
// exists — guests are explicitly out of scope this phase.
export const CARD_HOLDER_KIND = { OWNER: "OWNER", FAMILY: "FAMILY" };
export const CARD_HOLDER_KINDS = Object.values(CARD_HOLDER_KIND);

export const CARD_RESULT = {
  VALID: "VALID",
  INVALID_CARD: "INVALID_CARD",
  WRONG_SOCIETY: "WRONG_SOCIETY",
  REVOKED: "REVOKED",
  MEMBER_INACTIVE: "MEMBER_INACTIVE",
};

// How long a promoted waitlist entry stays reserved before the seat is
// offered to the next person in line.
export const DEFAULT_WAITLIST_HOLD_MINS = 1440;

import Notification from "@/models/Notification";
import { sendFcmToSociety, sendFcmToUser } from "@/lib/v1/fcm";
import { NOTIFICATION_TYPES } from "@/lib/v1/constants";

// Amenity notifications reuse the society-wide Notification collection.
//
// The brief suggested an `amenity_notifications` table. That was deliberately
// not created: a second notification store would mean two unread badges, two
// read-state models and two mark-as-read endpoints in an app that already has a
// working notification centre. Instead these rows carry AMENITY_* types plus
// metadata (amenityId, eventId) so the module can filter its own traffic while
// residents keep one inbox.
//
// Delivery is push + in-app today. Email/WhatsApp/SMS are deferred: adding them
// means extending the shared sender, not touching any of the callers below.

// A notification must never break the operation that triggered it. A resident's
// check-in is not rolled back because FCM was unreachable.
async function safeNotify(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[amenities] notification failed: ${label}`, err?.message);
    return null;
  }
}

// Fan-out to every resident of the society.
export async function notifySociety({
  societyId, type, title, message, actionUrl, metadata, priority = "normal", actor, audience = "all",
}) {
  return safeNotify(type, async () => {
    const doc = await Notification.create({
      societyId,
      type,
      title,
      message,
      priority,
      recipientType: "all",
      recipientIds: [],
      audience,
      actionUrl: actionUrl || "",
      metadata: metadata || {},
      createdBy: actor?.userId || null,
      createdByName: actor?.name || "",
    });
    await sendFcmToSociety(societyId, { title, body: message }, {
      type,
      notificationId: String(doc._id),
      ...(metadata?.amenityId ? { amenityId: String(metadata.amenityId) } : {}),
      ...(metadata?.eventId ? { eventId: String(metadata.eventId) } : {}),
    });
    return doc;
  });
}

// Targeted at one resident (waitlist promotion, visitor approval, rejection).
export async function notifyUser({
  societyId, userId, type, title, message, actionUrl, metadata, priority = "normal", actor,
}) {
  if (!userId) return null;
  return safeNotify(type, async () => {
    const doc = await Notification.create({
      societyId,
      type,
      title,
      message,
      priority,
      recipientType: "user",
      recipientIds: [String(userId)],
      audience: "all",
      actionUrl: actionUrl || "",
      metadata: metadata || {},
      createdBy: actor?.userId || null,
      createdByName: actor?.name || "",
    });
    await sendFcmToUser(userId, { title, body: message }, {
      type,
      notificationId: String(doc._id),
      ...(metadata?.amenityId ? { amenityId: String(metadata.amenityId) } : {}),
      ...(metadata?.eventId ? { eventId: String(metadata.eventId) } : {}),
    });
    return doc;
  });
}

// Deep links match the app's route table so tapping a push lands on the right
// screen rather than the notification list.
const amenityLink = (id) => `/amenities/${id}`;
const eventLink = (id) => `/amenities/events/${id}`;

function dateLabel(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function dateTimeLabel(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-IN", {
    day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
  });
}

// ------------------------------------------------------------- maintenance
export function notifyMaintenanceScheduled({ societyId, amenity, maintenance, actor }) {
  return notifySociety({
    societyId,
    type: "AMENITY_MAINTENANCE_SCHEDULED",
    title: `${amenity.name}: maintenance scheduled`,
    message: `${amenity.name} will be unavailable from ${dateLabel(maintenance.startDate)} to ${dateLabel(maintenance.endDate)}. Reason: ${maintenance.reason}`,
    actionUrl: amenityLink(amenity._id),
    metadata: { amenityId: amenity._id, maintenanceId: maintenance._id },
    actor,
  });
}

export function notifyMaintenanceUpdated({ societyId, amenity, maintenance, actor }) {
  return notifySociety({
    societyId,
    type: "AMENITY_MAINTENANCE_UPDATED",
    title: `${amenity.name}: maintenance updated`,
    message: `The maintenance window for ${amenity.name} is now ${dateLabel(maintenance.startDate)} to ${dateLabel(maintenance.endDate)}.`,
    actionUrl: amenityLink(amenity._id),
    metadata: { amenityId: amenity._id, maintenanceId: maintenance._id },
    actor,
  });
}

export function notifyMaintenanceExtended({ societyId, amenity, maintenance, previousEnd, actor }) {
  return notifySociety({
    societyId,
    type: "AMENITY_MAINTENANCE_EXTENDED",
    title: `${amenity.name}: maintenance extended`,
    message: `Maintenance on ${amenity.name} has been extended from ${dateLabel(previousEnd)} to ${dateLabel(maintenance.endDate)}. Reason: ${maintenance.extensions?.at(-1)?.reason || maintenance.reason}`,
    actionUrl: amenityLink(amenity._id),
    metadata: { amenityId: amenity._id, maintenanceId: maintenance._id },
    priority: "high",
    actor,
  });
}

export function notifyAmenityReopened({ societyId, amenity, early, actor }) {
  return notifySociety({
    societyId,
    type: "AMENITY_REOPENED",
    title: `${amenity.name} is open again`,
    message: early
      ? `Good news — ${amenity.name} has reopened ahead of schedule.`
      : `${amenity.name} has reopened and is available for use.`,
    actionUrl: amenityLink(amenity._id),
    metadata: { amenityId: amenity._id },
    actor,
  });
}

// ------------------------------------------------------------- status & rules
export function notifyStatusChanged({ societyId, amenity, status, note, actor, isEmergency }) {
  const isOpen = status === "OPEN";
  return notifySociety({
    societyId,
    type: isEmergency
      ? "AMENITY_EMERGENCY_CLOSURE"
      : isOpen ? "AMENITY_REOPENED" : "AMENITY_CLOSED",
    title: isEmergency
      ? `Urgent: ${amenity.name} closed`
      : `${amenity.name}: ${status.replace(/_/g, " ").toLowerCase()}`,
    message: note || (isOpen
      ? `${amenity.name} is now open.`
      : `${amenity.name} is currently unavailable.`),
    actionUrl: amenityLink(amenity._id),
    metadata: { amenityId: amenity._id, status },
    // Emergency closures ride the critical channel so they surface even when the
    // resident has muted routine amenity chatter.
    priority: isEmergency ? "critical" : isOpen ? "normal" : "high",
    actor,
  });
}

export function notifyRulesUpdated({ societyId, amenity, actor }) {
  return notifySociety({
    societyId,
    type: "AMENITY_RULES_UPDATED",
    title: `${amenity.name}: rules updated`,
    message: `The usage rules for ${amenity.name} have been updated. Please review them before your next visit.`,
    actionUrl: amenityLink(amenity._id),
    metadata: { amenityId: amenity._id },
    actor,
  });
}

// ------------------------------------------------------------- events
export function notifyEventCreated({ societyId, event, actor }) {
  return notifySociety({
    societyId,
    type: "AMENITY_EVENT_CREATED",
    title: `New event: ${event.title}`,
    message: `${event.title} at ${event.venue || event.amenityName} on ${dateTimeLabel(event.startAt)}.${event.registrationRequired ? " Registration is required." : ""}`,
    actionUrl: eventLink(event._id),
    metadata: { amenityId: event.amenityId, eventId: event._id },
    actor,
  });
}

export function notifyEventUpdated({ societyId, event, previous, actor }) {
  const timeChanged = previous && new Date(previous.startAt).getTime() !== new Date(event.startAt).getTime();
  return notifySociety({
    societyId,
    type: "AMENITY_EVENT_UPDATED",
    title: `Updated: ${event.title}`,
    message: timeChanged
      ? `${event.title} has been rescheduled to ${dateTimeLabel(event.startAt)}.`
      : `Details for ${event.title} have been updated.`,
    actionUrl: eventLink(event._id),
    metadata: { amenityId: event.amenityId, eventId: event._id },
    priority: timeChanged ? "high" : "normal",
    actor,
  });
}

export function notifyEventCancelled({ societyId, event, reason, actor }) {
  return notifySociety({
    societyId,
    type: "AMENITY_EVENT_CANCELLED",
    title: `Cancelled: ${event.title}`,
    message: reason
      ? `${event.title} on ${dateTimeLabel(event.startAt)} has been cancelled. ${reason}`
      : `${event.title} on ${dateTimeLabel(event.startAt)} has been cancelled.`,
    actionUrl: eventLink(event._id),
    metadata: { amenityId: event.amenityId, eventId: event._id },
    priority: "high",
    actor,
  });
}

// Reminders go only to registered residents, not the whole society.
export function notifyEventReminder({ societyId, event, userId }) {
  return notifyUser({
    societyId,
    userId,
    type: "AMENITY_EVENT_REMINDER",
    title: `Reminder: ${event.title}`,
    message: `${event.title} starts at ${dateTimeLabel(event.startAt)} — ${event.venue || event.amenityName}.`,
    actionUrl: eventLink(event._id),
    metadata: { amenityId: event.amenityId, eventId: event._id },
  });
}

export function notifyWaitlistPromoted({ societyId, event, userId, holdExpiresAt }) {
  return notifyUser({
    societyId,
    userId,
    type: "AMENITY_WAITLIST_PROMOTED",
    title: `A seat opened up: ${event.title}`,
    message: holdExpiresAt
      ? `You are now registered for ${event.title} on ${dateTimeLabel(event.startAt)}. Please confirm before ${dateTimeLabel(holdExpiresAt)}.`
      : `You are now registered for ${event.title} on ${dateTimeLabel(event.startAt)}.`,
    actionUrl: eventLink(event._id),
    metadata: { amenityId: event.amenityId, eventId: event._id },
    priority: "high",
  });
}

// ------------------------------------------------------------- incidents
// Incident traffic is addressed to committee/admin users, so the link points at
// the admin console rather than the resident app.
export function notifyIncidentReported({ societyId, incident, adminUserIds = [], actor }) {
  return Promise.all(adminUserIds.map((userId) => notifyUser({
    societyId,
    userId,
    type: "AMENITY_INCIDENT_REPORTED",
    title: `${incident.severity} incident: ${incident.amenityName}`,
    message: `${incident.title} — reported by ${incident.reportedByName || "a resident"}.`,
    actionUrl: `/admin/amenities/incidents?id=${incident._id}`,
    metadata: { amenityId: incident.amenityId, incidentId: incident._id },
    priority: incident.severity === "CRITICAL" ? "critical" : "high",
    actor,
  })));
}

export function notifyIncidentResolved({ societyId, incident, userId, actor }) {
  return notifyUser({
    societyId,
    userId,
    type: "AMENITY_INCIDENT_RESOLVED",
    title: "Your report has been resolved",
    message: `${incident.title} at ${incident.amenityName} has been marked resolved.${incident.resolutionNotes ? ` ${incident.resolutionNotes}` : ""}`,
    actionUrl: amenityLink(incident.amenityId),
    metadata: { amenityId: incident.amenityId, incidentId: incident._id },
    actor,
  });
}

export function notifyVisitorApprovalRequired({ societyId, visitor, adminUserIds = [], actor }) {
  return Promise.all(adminUserIds.map((userId) => notifyUser({
    societyId,
    userId,
    type: "AMENITY_VISITOR_APPROVAL_REQUIRED",
    title: `Visitor approval needed: ${visitor.amenityName}`,
    message: `${visitor.hostName || "A resident"} (${visitor.hostFlatNo || "-"}) has requested access for ${visitor.visitorName}.`,
    actionUrl: `/admin/amenities/attendance?visitorId=${visitor._id}`,
    metadata: { amenityId: visitor.amenityId, visitorId: visitor._id },
    priority: "high",
    actor,
  })));
}

export function notifyCheckInRejected({ societyId, userId, amenity, reason }) {
  return notifyUser({
    societyId,
    userId,
    type: "AMENITY_CHECKIN_REJECTED",
    title: `Check-in not allowed: ${amenity.name}`,
    message: reason,
    actionUrl: amenityLink(amenity._id),
    metadata: { amenityId: amenity._id },
  });
}

// Sent to the resident AFTER attendance has actually been written by
// attendanceService.checkIn(). Called from the clubhouse check-in route on the
// success path only — never from the scan step, so a scan that is refused for
// capacity, hours or eligibility can never produce a notification for a visit
// that did not happen.
//
// Addressed to the resident's account, not the society: this concerns one
// person's flat, and broadcasting it would be a privacy leak.
export function notifyCheckedInByStaff({ societyId, userId, amenity, slotLabel, byName, at }) {
  const when = dateTimeLabel(at || new Date());
  return notifyUser({
    societyId,
    userId,
    type: NOTIFICATION_TYPES.AMENITY_CHECKED_IN,
    title: `Checked in — ${amenity.name}`,
    message: slotLabel
      ? `You were checked in to ${amenity.name} for ${slotLabel} at ${when}${byName ? ` by ${byName}` : ""}.`
      : `You were checked in to ${amenity.name} at ${when}${byName ? ` by ${byName}` : ""}.`,
    actionUrl: amenityLink(amenity._id),
    metadata: { amenityId: amenity._id, slotLabel: slotLabel || "" },
  });
}

export function notifyCheckedOutByStaff({ societyId, userId, amenity, durationMins, byName }) {
  return notifyUser({
    societyId,
    userId,
    type: NOTIFICATION_TYPES.AMENITY_CHECKED_OUT,
    title: `Checked out — ${amenity.name}`,
    message: `Your ${amenity.name} session was closed${
      Number.isFinite(durationMins) ? ` after ${durationMins} min` : ""
    }${byName ? ` by ${byName}` : ""}.`,
    actionUrl: amenityLink(amenity._id),
    metadata: { amenityId: amenity._id },
  });
}

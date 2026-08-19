import AmenityEvent from "@/models/amenities/AmenityEvent";
import AmenityEventRegistration from "@/models/amenities/AmenityEventRegistration";
import AmenityWaitlist from "@/models/amenities/AmenityWaitlist";
import {
  EVENT_STATUS, REGISTRATION_STATUS, WAITLIST_STATUS, ACTIVITY_ACTION,
} from "./constants";
import { logAmenityActivity } from "./activityLog";
import { promoteFromWaitlist } from "./waitlistService";
import { notifyEventReminder, notifyEventCancelled } from "./notify";
import { isDuplicateKeyError } from "@/lib/mongoErrors";

// Event registration.
//
// Seat accounting is the other concurrency-critical path in the module. Capacity
// is claimed with a guarded conditional update evaluated by Mongo:
//
//   { _id, $expr: { $lte: [ { $add: ["$registeredCount", seats] }, "$capacity" ] } }
//
// Because the comparison happens inside the same atomic document update as the
// increment, two residents racing for the final seat cannot both win: one filter
// matches, the other returns null and receives EVENT_FULL. The counter is claimed
// BEFORE the registration row is inserted, and refunded if the insert fails.

export class RegistrationError extends Error {
  constructor(code, message, meta) {
    super(message);
    this.name = "RegistrationError";
    this.code = code;
    this.meta = meta;
  }
}

function assertOpenForRegistration(event) {
  if (event.status === EVENT_STATUS.CANCELLED) {
    throw new RegistrationError("EVENT_CANCELLED", "This event has been cancelled");
  }
  if (event.status !== EVENT_STATUS.PUBLISHED) {
    throw new RegistrationError("EVENT_NOT_OPEN", "This event is not open for registration yet");
  }
  if (!event.registrationRequired) {
    throw new RegistrationError("NO_REGISTRATION", "This event does not need registration — just turn up");
  }
  const now = new Date();
  if (new Date(event.startAt) <= now) {
    throw new RegistrationError("EVENT_STARTED", "This event has already started");
  }
  if (event.registrationDeadline && new Date(event.registrationDeadline) < now) {
    throw new RegistrationError("REGISTRATION_CLOSED", "Registration for this event has closed");
  }
}

export async function registerForEvent({ societyId, event, member, guestCount = 0, note }) {
  assertOpenForRegistration(event);

  const guests = Math.max(0, Number(guestCount) || 0);
  if (guests > 0 && !event.guestsAllowed) {
    throw new RegistrationError("GUESTS_NOT_ALLOWED", "Guests are not allowed at this event");
  }
  if (guests > (event.maxGuestsPerRegistration || 0)) {
    throw new RegistrationError("GUEST_LIMIT",
      `You can bring up to ${event.maxGuestsPerRegistration || 0} guest(s) to this event`);
  }

  const existing = await AmenityEventRegistration.findOne({
    eventId: event._id,
    memberId: member.memberId,
    status: { $ne: REGISTRATION_STATUS.CANCELLED },
  }).lean();
  if (existing) {
    throw new RegistrationError("ALREADY_REGISTERED", "You are already registered for this event");
  }

  const seats = 1 + guests;

  // Unlimited-capacity events skip the guard but still count, so the organiser
  // knows how many people to expect.
  const claimed = event.capacity
    ? await AmenityEvent.findOneAndUpdate(
        { _id: event._id, $expr: { $lte: [{ $add: ["$registeredCount", seats] }, "$capacity"] } },
        { $inc: { registeredCount: seats, guestCount: guests } },
        { new: true },
      ).lean()
    : await AmenityEvent.findByIdAndUpdate(
        event._id,
        { $inc: { registeredCount: seats, guestCount: guests } },
        { new: true },
      ).lean();

  if (!claimed) {
    const seatsLeft = Math.max(0, (event.capacity || 0) - (event.registeredCount || 0));
    throw new RegistrationError("EVENT_FULL",
      event.waitlistEnabled
        ? "This event is full. You can join the waitlist instead."
        : "This event is full.",
      { seatsLeft, waitlistEnabled: Boolean(event.waitlistEnabled) });
  }

  let registration;
  try {
    registration = await AmenityEventRegistration.create({
      societyId,
      eventId: event._id,
      amenityId: event.amenityId,
      memberId: member.memberId,
      userId: member.userId || null,
      memberName: member.name || "",
      flatNo: member.flatNo || "",
      occupancyType: member.occupancyType || null,
      guestCount: guests,
      note: note || "",
      status: REGISTRATION_STATUS.CONFIRMED,
    });
  } catch (err) {
    // Refund the seats so a failed insert does not shrink the event.
    await AmenityEvent.findByIdAndUpdate(event._id, {
      $inc: { registeredCount: -seats, guestCount: -guests },
    }).catch(() => {});
    if (isDuplicateKeyError(err)) {
      throw new RegistrationError("ALREADY_REGISTERED", "You are already registered for this event");
    }
    throw err;
  }

  // A resident who was queued and then registered directly should not stay in
  // the queue holding a phantom position.
  await AmenityWaitlist.updateOne(
    { eventId: event._id, memberId: member.memberId, status: WAITLIST_STATUS.WAITING },
    { $set: { status: WAITLIST_STATUS.LEFT, leftAt: new Date() } },
  );

  await logAmenityActivity({
    societyId,
    entityType: "EVENT_REGISTRATION",
    entityId: registration._id,
    amenityId: event.amenityId,
    amenityName: event.amenityName,
    action: ACTIVITY_ACTION.EVENT_REGISTERED,
    actor: { userId: member.userId, name: member.name, role: "Member" },
    newValue: { eventId: String(event._id), guestCount: guests },
  });

  const seatsLeft = claimed.capacity ? Math.max(0, claimed.capacity - claimed.registeredCount) : null;
  return { registration, seatsLeft, event: claimed };
}

export async function cancelRegistration({ societyId, event, memberId, reason, settings, actor }) {
  const registration = await AmenityEventRegistration.findOneAndUpdate(
    { eventId: event._id, memberId, status: { $ne: REGISTRATION_STATUS.CANCELLED } },
    {
      $set: {
        status: REGISTRATION_STATUS.CANCELLED,
        cancelledAt: new Date(),
        cancellationReason: reason || "",
      },
    },
    { new: true },
  );
  if (!registration) {
    throw new RegistrationError("NOT_REGISTERED", "You are not registered for this event");
  }

  const seats = 1 + (registration.guestCount || 0);
  await AmenityEvent.findByIdAndUpdate(event._id, {
    $inc: { registeredCount: -seats, guestCount: -(registration.guestCount || 0) },
  });

  await logAmenityActivity({
    societyId,
    entityType: "EVENT_REGISTRATION",
    entityId: registration._id,
    amenityId: event.amenityId,
    amenityName: event.amenityName,
    action: ACTIVITY_ACTION.EVENT_REGISTRATION_CANCELLED,
    actor: actor || { userId: registration.userId, name: registration.memberName, role: "Member" },
    oldValue: { status: REGISTRATION_STATUS.CONFIRMED },
    newValue: { status: REGISTRATION_STATUS.CANCELLED, reason: reason || "" },
  });

  // The freed seat immediately goes to whoever is next in line — the whole point
  // of the waitlist.
  const { promoted } = await promoteFromWaitlist({
    societyId, eventId: event._id, settings, limit: 5,
  });

  return { registration, promoted };
}

export async function cancelEvent({ societyId, event, reason, actor }) {
  const updated = await AmenityEvent.findByIdAndUpdate(
    event._id,
    {
      $set: {
        status: EVENT_STATUS.CANCELLED,
        cancellationReason: reason || "",
        cancelledAt: new Date(),
        updatedBy: actor?.userId || null,
      },
    },
    { new: true },
  ).lean();

  // Registrations are marked cancelled, never deleted: the organiser still needs
  // to know who had signed up, and residents need it in their history.
  await AmenityEventRegistration.updateMany(
    { eventId: event._id, status: { $ne: REGISTRATION_STATUS.CANCELLED } },
    {
      $set: {
        status: REGISTRATION_STATUS.CANCELLED,
        cancelledAt: new Date(),
        cancellationReason: reason || "Event cancelled",
      },
    },
  );
  await AmenityWaitlist.updateMany(
    { eventId: event._id, status: WAITLIST_STATUS.WAITING },
    { $set: { status: WAITLIST_STATUS.LEFT, leftAt: new Date() } },
  );

  await notifyEventCancelled({ societyId, event: updated, reason, actor });

  await logAmenityActivity({
    societyId,
    entityType: "EVENT",
    entityId: event._id,
    amenityId: event.amenityId,
    amenityName: event.amenityName,
    action: ACTIVITY_ACTION.EVENT_CANCELLED,
    actor,
    newValue: { reason: reason || "" },
  });

  return updated;
}

// Sends reminders for events starting inside the lead window.
//
// Idempotent by design: reminderSentAt is set on the event before the per-member
// sends, and the query excludes events that already have it. Running the job
// twice — or two workers running it at once — cannot double-notify residents.
export async function sendDueReminders({ societyId, leadMins, now = new Date(), limit = 50 }) {
  const windowEnd = new Date(now.getTime() + leadMins * 60000);

  const due = await AmenityEvent.find({
    societyId,
    status: EVENT_STATUS.PUBLISHED,
    reminderSentAt: null,
    startAt: { $gt: now, $lte: windowEnd },
  }).limit(limit).lean();

  const results = [];

  for (const event of due) {
    // Claim the event first. If another worker already claimed it, skip.
    const claimed = await AmenityEvent.findOneAndUpdate(
      { _id: event._id, reminderSentAt: null },
      { $set: { reminderSentAt: new Date() } },
      { new: true },
    ).lean();
    if (!claimed) continue;

    const registrations = await AmenityEventRegistration.find({
      eventId: event._id,
      status: REGISTRATION_STATUS.CONFIRMED,
    }).select("userId").lean();

    // Unregistered events still deserve a nudge, but only to people who signed
    // up; a society-wide blast for every yoga class would train residents to mute
    // notifications entirely.
    let sent = 0;
    for (const reg of registrations) {
      if (!reg.userId) continue;
      await notifyEventReminder({ societyId, event, userId: reg.userId });
      sent += 1;
    }

    results.push({ eventId: event._id, title: event.title, sent });
  }

  return { events: results, count: results.length };
}

// Marks a finished event complete and banks its attendance figure.
export async function closeOutEvent({ event }) {
  const attended = await AmenityEventRegistration.countDocuments({
    eventId: event._id,
    status: REGISTRATION_STATUS.ATTENDED,
  });
  return AmenityEvent.findByIdAndUpdate(
    event._id,
    { $set: { status: EVENT_STATUS.COMPLETED, attendedCount: attended } },
    { new: true },
  ).lean();
}

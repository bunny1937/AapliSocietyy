import AmenityWaitlist from "@/models/amenities/AmenityWaitlist";
import AmenityEvent from "@/models/amenities/AmenityEvent";
import AmenityEventRegistration from "@/models/amenities/AmenityEventRegistration";
import {
  WAITLIST_STATUS, WAITLIST_SCOPE, REGISTRATION_STATUS, EVENT_STATUS,
  ACTIVITY_ACTION, DEFAULT_WAITLIST_HOLD_MINS,
} from "./constants";
import { logAmenityActivity } from "./activityLog";
import { isDuplicateKeyError } from "@/lib/mongoErrors";
import { notifyWaitlistPromoted } from "./notify";

// Waitlists.
//
// Built generically (scope = EVENT | SLOT | BOOKING) so that when slot booking is
// switched on, the queue, the promotion mechanics and the notification all work
// unchanged — only the scope value differs. Today only EVENT is reachable.

export class WaitlistError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WaitlistError";
    this.code = code;
  }
}

export async function joinEventWaitlist({ societyId, event, member, guestCount = 0 }) {
  if (!event.waitlistEnabled) {
    throw new WaitlistError("WAITLIST_DISABLED", "There is no waitlist for this event");
  }
  if (event.status !== EVENT_STATUS.PUBLISHED) {
    throw new WaitlistError("EVENT_NOT_OPEN", "This event is not open for registration");
  }

  // Someone already holding a seat cannot also hold a queue position.
  const existingReg = await AmenityEventRegistration.findOne({
    eventId: event._id,
    memberId: member.memberId,
    status: { $ne: REGISTRATION_STATUS.CANCELLED },
  }).select("_id").lean();
  if (existingReg) {
    throw new WaitlistError("ALREADY_REGISTERED", "You are already registered for this event");
  }

  const existing = await AmenityWaitlist.findOne({
    eventId: event._id,
    memberId: member.memberId,
    status: WAITLIST_STATUS.WAITING,
  }).lean();
  // Idempotent: tapping "join" twice returns the same position rather than
  // erroring or creating a duplicate.
  if (existing) return { entry: existing };

  // Position is derived from the current tail. Two residents can read the
  // same tail and both compute the same "next" position; the unique index on
  // (eventId, position) turns the loser's insert into a duplicate-key error,
  // which is retried against a freshly-read tail rather than surfaced.
  let entry;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const last = await AmenityWaitlist.findOne({ eventId: event._id, status: WAITLIST_STATUS.WAITING })
      .sort({ position: -1 })
      .select("position")
      .lean();
    const position = (last?.position || 0) + 1;

    try {
      entry = await AmenityWaitlist.create({
        societyId,
        scope: WAITLIST_SCOPE.EVENT,
        amenityId: event.amenityId,
        eventId: event._id,
        memberId: member.memberId,
        userId: member.userId || null,
        memberName: member.name || "",
        flatNo: member.flatNo || "",
        guestCount,
        position,
        status: WAITLIST_STATUS.WAITING,
      });
      break;
    } catch (err) {
      if (isDuplicateKeyError(err) && attempt < 19) continue;
      throw err;
    }
  }

  await AmenityEvent.findByIdAndUpdate(event._id, { $inc: { waitlistCount: 1 } });

  await logAmenityActivity({
    societyId,
    entityType: "WAITLIST",
    entityId: entry._id,
    amenityId: event.amenityId,
    amenityName: event.amenityName,
    action: ACTIVITY_ACTION.WAITLIST_JOINED,
    actor: { userId: member.userId, name: member.name, role: "Member" },
    newValue: { eventId: String(event._id), position: entry.position },
  });

  return { entry };
}

export async function leaveEventWaitlist({ eventId, memberId, actor }) {
  const entry = await AmenityWaitlist.findOneAndUpdate(
    { eventId, memberId, status: WAITLIST_STATUS.WAITING },
    { $set: { status: WAITLIST_STATUS.LEFT, leftAt: new Date() } },
    { new: true },
  );
  if (!entry) throw new WaitlistError("NOT_QUEUED", "You are not on the waitlist for this event");

  await AmenityEvent.findByIdAndUpdate(eventId, { $inc: { waitlistCount: -1 } });

  // Resequence everyone behind them, so nobody is told they are "number 7" in a
  // queue of three.
  await AmenityWaitlist.updateMany(
    { eventId, status: WAITLIST_STATUS.WAITING, position: { $gt: entry.position } },
    { $inc: { position: -1 } },
  );

  await logAmenityActivity({
    societyId: entry.societyId,
    entityType: "WAITLIST",
    entityId: entry._id,
    amenityId: entry.amenityId,
    action: ACTIVITY_ACTION.WAITLIST_LEFT,
    actor: actor || { userId: entry.userId, name: entry.memberName, role: "Member" },
    oldValue: { position: entry.position },
  });

  return entry;
}

// Fills freed seats in strict queue order.
//
// Called whenever capacity opens up (a cancellation, or an admin raising the
// capacity). Each promotion claims its seat with the same guarded atomic $inc the
// direct registration path uses, so a promotion can never overfill an event even
// if a walk-up registration lands in the same instant.
export async function promoteFromWaitlist({ societyId, eventId, settings, limit = 10 }) {
  const event = await AmenityEvent.findById(eventId).lean();
  if (!event || event.status !== EVENT_STATUS.PUBLISHED) return { promoted: [] };

  // Unlimited capacity means nobody should be queued at all.
  if (!event.capacity) return { promoted: [] };

  const holdMins = settings?.waitlistHoldMins || DEFAULT_WAITLIST_HOLD_MINS;
  const queue = await AmenityWaitlist.find({ eventId, status: WAITLIST_STATUS.WAITING })
    .sort({ position: 1 })
    .limit(limit)
    .lean();

  const promoted = [];

  for (const entry of queue) {
    const seats = 1 + (entry.guestCount || 0);

    const claimed = await AmenityEvent.findOneAndUpdate(
      { _id: eventId, $expr: { $lte: [{ $add: ["$registeredCount", seats] }, "$capacity"] } },
      { $inc: { registeredCount: seats, guestCount: entry.guestCount || 0, waitlistCount: -1 } },
      { new: true },
    ).lean();

    // Event refilled from elsewhere — stop, leaving the rest of the queue intact.
    if (!claimed) break;

    const holdExpiresAt = new Date(Date.now() + holdMins * 60000);

    try {
      await AmenityEventRegistration.create({
        societyId,
        eventId,
        amenityId: event.amenityId,
        memberId: entry.memberId,
        userId: entry.userId,
        memberName: entry.memberName,
        flatNo: entry.flatNo,
        guestCount: entry.guestCount || 0,
        status: REGISTRATION_STATUS.CONFIRMED,
        fromWaitlist: true,
      });
    } catch (err) {
      // Give the seat back rather than stranding it.
      await AmenityEvent.findByIdAndUpdate(eventId, {
        $inc: { registeredCount: -seats, guestCount: -(entry.guestCount || 0), waitlistCount: 1 },
      });
      if (isDuplicateKeyError(err)) continue;
      throw err;
    }

    await AmenityWaitlist.updateOne(
      { _id: entry._id },
      { $set: { status: WAITLIST_STATUS.PROMOTED, promotedAt: new Date(), holdExpiresAt } },
    );

    await notifyWaitlistPromoted({
      societyId,
      event: { ...event, _id: eventId },
      userId: entry.userId,
      holdExpiresAt,
    });

    await logAmenityActivity({
      societyId,
      entityType: "WAITLIST",
      entityId: entry._id,
      amenityId: event.amenityId,
      amenityName: event.amenityName,
      action: ACTIVITY_ACTION.WAITLIST_PROMOTED,
      actor: { name: "System", role: "System" },
      newValue: { memberId: String(entry.memberId), eventId: String(eventId), seats },
      note: `Promoted from waitlist position ${entry.position}`,
    });

    promoted.push({ ...entry, holdExpiresAt });
  }

  // Close the gaps left by everyone promoted.
  if (promoted.length) {
    const remaining = await AmenityWaitlist.find({ eventId, status: WAITLIST_STATUS.WAITING })
      .sort({ position: 1 })
      .select("_id")
      .lean();
    // Sequential, not Promise.all: positions only ever move down (gap
    // compaction), so processing lowest-original-position first guarantees
    // each target slot is already vacated before it is claimed. Running these
    // concurrently races the unique (eventId, position) index - two updates
    // can be in flight for the same target position at once.
    for (let idx = 0; idx < remaining.length; idx += 1) {
      await AmenityWaitlist.updateOne({ _id: remaining[idx]._id }, { $set: { position: idx + 1 } });
    }
  }

  return { promoted };
}

export function getEventWaitlist(eventId) {
  return AmenityWaitlist.find({ eventId, status: WAITLIST_STATUS.WAITING })
    .sort({ position: 1 })
    .lean();
}

export async function getMyWaitlistPosition({ eventId, memberId }) {
  const entry = await AmenityWaitlist.findOne({
    eventId,
    memberId,
    status: { $in: [WAITLIST_STATUS.WAITING, WAITLIST_STATUS.PROMOTED] },
  }).lean();
  if (!entry) return null;
  return {
    status: entry.status,
    position: entry.position,
    joinedAt: entry.createdAt,
    holdExpiresAt: entry.holdExpiresAt,
  };
}

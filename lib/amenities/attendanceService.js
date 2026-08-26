import mongoose from "mongoose";
import Amenity from "@/models/amenities/Amenity";
import AmenityAttendance from "@/models/amenities/AmenityAttendance";
import { ATTENDEE_TYPE, CHECKIN_METHOD, ATTENDANCE_MODE, ACTIVITY_ACTION } from "./constants";
import { dayKey, dayOfWeek, minutesOfDay, minutesBetween, addMinutes } from "./time";
import { resolveEffectiveStatus } from "./availability";
import { checkEligibility } from "./permissions";
import { findSlotAt } from "./slotEngine";
import { getTimezone } from "./settingsService";
import { logAmenityActivity } from "./activityLog";
import { isDuplicateKeyError } from "@/lib/mongoErrors";
import { bumpDailyOnCheckIn, bumpDailyOnCheckOut } from "./analyticsService";

// Attendance + live capacity.
//
// This is the module's only concurrency-critical path. Two residents scanning the
// last free slot of a 20-person gym in the same instant must not both get in.
// A transaction would work here too (the deployment target is Atlas, which is
// always a replica set — see lib/mongodb.js), but a single-document atomic
// update is cheaper than a session for a check confined to one document.
// Capacity is claimed with a single guarded atomic update:
//
//   findOneAndUpdate({ _id, liveOccupancy: { $lt: max } }, { $inc: { liveOccupancy: +1 } })
//
// Mongo applies that per-document update atomically, so exactly one of the two
// racing requests matches the filter and the other gets null and a clean
// CAPACITY_FULL. The seat is claimed BEFORE the attendance row is written, and
// released again if the write fails — leaking a row is recoverable by an admin,
// silently overfilling a swimming pool is not.

export class CheckInError extends Error {
  constructor(code, message, meta) {
    super(message);
    this.name = "CheckInError";
    this.code = code;
    this.meta = meta;
  }
}

// Presentation-ready capacity, shared by the admin dashboard and the app.
export function capacitySnapshot(amenity) {
  const capacity = amenity?.capacity || {};
  const current = amenity?.liveOccupancy || 0;
  const unlimited = capacity.unlimited !== false;
  const threshold = capacity.warningThresholdPct ?? 80;

  if (unlimited || !capacity.maxOccupancy) {
    return {
      unlimited: true, maxOccupancy: null, current,
      remaining: null, usagePct: null, level: "UNLIMITED",
      warningThresholdPct: threshold,
    };
  }

  const max = capacity.maxOccupancy;
  const usagePct = Math.min(100, Math.round((current / max) * 100));
  return {
    unlimited: false,
    maxOccupancy: max,
    current,
    remaining: Math.max(0, max - current),
    usagePct,
    level: current >= max ? "FULL" : usagePct >= threshold ? "WARNING" : "OK",
    warningThresholdPct: threshold,
  };
}

// Claims one unit of capacity. Returns the updated amenity, or null when full.
async function claimCapacity(amenityId, units) {
  const amenity = await Amenity.findById(amenityId).select("capacity liveOccupancy").lean();
  if (!amenity) throw new CheckInError("NOT_FOUND", "Amenity not found");

  const capacity = amenity.capacity || {};
  if (capacity.unlimited !== false || !capacity.maxOccupancy) {
    // Unlimited: still counted, so occupancy and analytics stay meaningful.
    return Amenity.findByIdAndUpdate(amenityId, { $inc: { liveOccupancy: units } }, { new: true }).lean();
  }

  // The guard: only increment while the result stays within the limit.
  return Amenity.findOneAndUpdate(
    { _id: amenityId, liveOccupancy: { $lte: capacity.maxOccupancy - units } },
    { $inc: { liveOccupancy: units } },
    { new: true },
  ).lean();
}

async function releaseCapacity(amenityId, units) {
  // $max clamps at zero: a stale double-release must never drive occupancy
  // negative, which would silently grant free seats later.
  await Amenity.findByIdAndUpdate(amenityId, [
    { $set: { liveOccupancy: { $max: [0, { $subtract: ["$liveOccupancy", units] }] } } },
  ]);
}

export async function checkIn({
  societyId, amenity, attendeeType = ATTENDEE_TYPE.RESIDENT,
  memberId, userId, residentName, flatNo, occupancyType, age,
  visitorName, visitorPhone, visitorId, hostMemberId,
  eventId, guestCount = 0, notes,
  method = CHECKIN_METHOD.MANUAL, isOverride = false, overrideReason,
  qrTokenId, checkedInBy, checkedInByName, checkedInByRole,
  // Staff-recorded attendance skips resident eligibility on purpose: a guard at
  // the desk can admit a resident whose profile lacks a date of birth, or admit
  // a coach outside normal hours, and the row records who authorised it.
  skipEligibility = false,
  actor,
}) {
  const timezone = await getTimezone(societyId);
  const now = new Date();

  if (amenity.attendanceMode === ATTENDANCE_MODE.NONE) {
    throw new CheckInError("NOT_ELIGIBLE", "Attendance is not tracked for this amenity");
  }
  // A QR-only amenity may only be entered by scanning, unless staff explicitly
  // override with the permission to do so.
  if (amenity.attendanceMode === ATTENDANCE_MODE.QR && method === CHECKIN_METHOD.MANUAL && !isOverride) {
    throw new CheckInError("NOT_ELIGIBLE", "This amenity accepts QR check-in only");
  }

  // Availability is enforced for residents; an override records the bypass.
  const effective = await resolveEffectiveStatus({ amenity, at: now, timezone });
  if (!effective.isUsable && !isOverride) {
    const code = effective.state === "CLOSED_NOW" || effective.state === "CLOSED_TODAY"
      ? "OUTSIDE_HOURS"
      : "AMENITY_CLOSED";
    throw new CheckInError(code, effective.reason || "This amenity is not available right now", {
      state: effective.state,
    });
  }

  if (!skipEligibility && attendeeType === ATTENDEE_TYPE.RESIDENT) {
    const { eligible, reason } = checkEligibility({
      amenity,
      occupancyType,
      role: actor?.role,
      age,
    });
    if (!eligible) throw new CheckInError("NOT_ELIGIBLE", reason);
  }

  // Guard the same person being inside twice. This is a real scenario: a
  // resident scans, the response is slow, they scan again.
  if (memberId) {
    const open = await AmenityAttendance.findOne({
      amenityId: amenity._id,
      memberId,
      timeOut: null,
    }).select("_id timeIn").lean();
    if (open) {
      throw new CheckInError("ALREADY_CHECKED_IN", "You are already checked in to this amenity", {
        attendanceId: open._id, since: open.timeIn,
      });
    }
  }

  // One person + their guests all occupy space.
  const units = 1 + Math.max(0, Number(guestCount) || 0);
  const claimed = await claimCapacity(amenity._id, units);
  if (!claimed) {
    const snap = capacitySnapshot(amenity);
    throw new CheckInError("CAPACITY_FULL",
      `${amenity.name} is at full capacity (${snap.maxOccupancy} people). Please try again shortly.`,
      { capacity: snap });
  }

  try {
    // Resolve the slot from the day-of-week templates so analytics can attribute
    // usage to a slot even though no dated slot rows exist yet.
    let slot = null;
    if (amenity.slotPolicy?.enabled) {
      slot = await findSlotAt({
        amenityId: amenity._id,
        dayOfWeek: dayOfWeek(now, timezone),
        minutes: minutesOfDay(now, timezone),
      });
    }

    const row = await AmenityAttendance.create({
      societyId,
      amenityId: amenity._id,
      amenityName: amenity.name,
      attendeeType,
      memberId: memberId || null,
      userId: userId || null,
      residentName: residentName || "",
      flatNo: flatNo || "",
      occupancyType: occupancyType || null,
      visitorId: visitorId || null,
      visitorName: visitorName || "",
      visitorPhone: visitorPhone || "",
      hostMemberId: hostMemberId || null,
      guestCount: Math.max(0, Number(guestCount) || 0),
      timeIn: now,
      timeOut: null,
      slotId: slot?._id || null,
      slotLabel: slot?.label || "",
      eventId: eventId || null,
      checkInMethod: method,
      qrTokenId: qrTokenId || null,
      checkedInBy: checkedInBy || null,
      checkedInByName: checkedInByName || "",
      checkedInByRole: checkedInByRole || "",
      isOverride,
      overrideReason: overrideReason || "",
      notes: notes || "",
      dayKey: dayKey(now, timezone),
    });

    // `claimed`, not `amenity`: amenity is the pre-claim snapshot fetched
    // before claimCapacity() incremented liveOccupancy, so the peak-tracking
    // read inside bumpDailyOnCheckIn would always be one check-in behind.
    await bumpDailyOnCheckIn({ societyId, amenity: claimed, attendance: row, timezone });

    await logAmenityActivity({
      societyId,
      entityType: "ATTENDANCE",
      entityId: row._id,
      amenityId: amenity._id,
      amenityName: amenity.name,
      action: ACTIVITY_ACTION.ATTENDANCE_CHECK_IN,
      actor,
      newValue: {
        attendeeType, method, guestCount: row.guestCount,
        who: residentName || visitorName || String(memberId || ""),
        isOverride,
      },
      note: isOverride ? `Override: ${overrideReason || "no reason given"}` : "",
    });

    return { attendance: row, capacity: capacitySnapshot(claimed), slot };
  } catch (err) {
    // Give the seat back — otherwise a failed insert would permanently shrink
    // the amenity's usable capacity until someone recomputed it.
    await releaseCapacity(amenity._id, units).catch(() => {});
    // The findOne check above is a TOCTOU race under concurrent requests; the
    // partial unique index on (amenityId, memberId, timeOut) is the real
    // guard, and a losing racer hits it as a duplicate-key error here.
    if (isDuplicateKeyError(err)) {
      throw new CheckInError("ALREADY_CHECKED_IN", "You are already checked in to this amenity");
    }
    throw err;
  }
}

export async function checkOut({
  societyId, attendanceId, amenityId, memberId, visitorPhone,
  method = CHECKIN_METHOD.MANUAL, checkedOutBy, checkedOutByName, actor,
}) {
  const filter = attendanceId
    ? { _id: attendanceId, timeOut: null }
    : {
        amenityId,
        timeOut: null,
        ...(memberId ? { memberId } : {}),
        ...(!memberId && visitorPhone ? { visitorPhone } : {}),
      };

  const now = new Date();

  // Atomic close: the filter requires timeOut to still be null, so two
  // simultaneous check-out taps cannot both succeed and double-release a seat.
  const row = await AmenityAttendance.findOneAndUpdate(
    filter,
    [{
      $set: {
        timeOut: now,
        checkOutMethod: method,
        checkedOutBy: checkedOutBy || null,
        checkedOutByName: checkedOutByName || "",
        durationMins: {
          $max: [0, { $round: [{ $divide: [{ $subtract: [now, "$timeIn"] }, 60000] }, 0] }],
        },
      },
    }],
    { new: true, sort: { timeIn: -1 } },
  );

  if (!row) {
    throw new CheckInError("NOT_CHECKED_IN", "No open check-in was found to close");
  }

  const units = 1 + (row.guestCount || 0);
  await releaseCapacity(row.amenityId, units);

  await bumpDailyOnCheckOut({ societyId, attendance: row });

  await logAmenityActivity({
    societyId,
    entityType: "ATTENDANCE",
    entityId: row._id,
    amenityId: row.amenityId,
    amenityName: row.amenityName,
    action: ACTIVITY_ACTION.ATTENDANCE_CHECK_OUT,
    actor,
    newValue: { timeOut: row.timeOut, durationMins: row.durationMins, method },
  });

  const amenity = await Amenity.findById(row.amenityId).select("capacity liveOccupancy name").lean();
  return { attendance: row, capacity: amenity ? capacitySnapshot(amenity) : null };
}

// Closes sessions nobody checked out of.
//
// Without this, one resident who forgets to check out holds a gym slot forever
// and the amenity reads "full" the next morning. Auto-closed rows are flagged so
// they can be excluded from average-duration statistics rather than skewing them.
export async function autoCheckoutStale({ societyId, amenityId, afterMins, timezone }) {
  const cutoff = addMinutes(new Date(), -Math.abs(afterMins));

  const stale = await AmenityAttendance.find({
    societyId,
    ...(amenityId ? { amenityId } : {}),
    timeOut: null,
    timeIn: { $lte: cutoff },
  }).select("_id amenityId amenityName timeIn guestCount").lean();

  let closed = 0;
  for (const row of stale) {
    // The cutoff, not "now", is used as the close time: crediting a forgotten
    // session with fourteen hours of usage would corrupt the duration metrics.
    const timeOut = addMinutes(row.timeIn, Math.abs(afterMins));
    const updated = await AmenityAttendance.findOneAndUpdate(
      { _id: row._id, timeOut: null },
      {
        $set: {
          timeOut,
          durationMins: minutesBetween(row.timeIn, timeOut),
          autoCheckedOut: true,
          notes: "Automatically checked out — no check-out was recorded",
        },
      },
      { new: true },
    );
    if (!updated) continue;

    await releaseCapacity(row.amenityId, 1 + (row.guestCount || 0));
    await bumpDailyOnCheckOut({ societyId, attendance: updated });
    closed += 1;
  }

  if (closed) {
    await logAmenityActivity({
      societyId,
      entityType: "ATTENDANCE",
      amenityId: amenityId || null,
      action: ACTIVITY_ACTION.ATTENDANCE_AUTO_CLOSED,
      actor: { name: "System", role: "System" },
      newValue: { closed, afterMins },
      note: `Auto-closed ${closed} open check-in(s)`,
    });
  }

  return { closed, scanned: stale.length };
}

// Self-heals liveOccupancy from the ledger. Occupancy is a cache; attendance is
// the truth. Exposed so an admin can repair drift after a crash mid-check-in
// without touching the database directly.
export async function recomputeOccupancy(amenityId) {
  const rows = await AmenityAttendance.aggregate([
    { $match: { amenityId: new mongoose.Types.ObjectId(String(amenityId)), timeOut: null } },
    { $group: { _id: null, people: { $sum: { $add: [1, { $ifNull: ["$guestCount", 0] }] } } } },
  ]);
  const people = rows[0]?.people || 0;
  const amenity = await Amenity.findByIdAndUpdate(
    amenityId,
    { $set: { liveOccupancy: people } },
    { new: true },
  ).select("capacity liveOccupancy name").lean();
  return { liveOccupancy: people, capacity: amenity ? capacitySnapshot(amenity) : null };
}

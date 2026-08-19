import AmenityAvailability from "@/models/amenities/AmenityAvailability";
import AmenityMaintenance from "@/models/amenities/AmenityMaintenance";
import {
  AMENITY_STATUS, MAINTENANCE_STATUS, CLOSURE_TYPE, DAY_LABELS,
} from "./constants";
import { dayOfWeek, minutesOfDay, fromMinutes, toMinutes, rangesOverlap } from "./time";

// The one function that answers "can someone use this right now?".
//
// Four independent things can close an amenity: its manual status, an active
// maintenance window, a dated holiday/temporary closure, and the weekly opening
// grid. Resolving them in ONE place is what stops the resident app, the admin
// dashboard and the check-in endpoint from disagreeing about whether the pool is
// open.
//
// Precedence, strongest first:
//   1. isActive = false          (hidden/not in service)
//   2. PERMANENTLY_CLOSED
//   3. manual status (CLOSED / TEMPORARILY_CLOSED / UNDER_MAINTENANCE)
//   4. active maintenance record
//   5. dated closure covering now
//   6. weekly opening hours
export const EFFECTIVE = {
  OPEN: "OPEN",
  CLOSED_NOW: "CLOSED_NOW",
  CLOSED_TODAY: "CLOSED_TODAY",
  UNDER_MAINTENANCE: "UNDER_MAINTENANCE",
  HOLIDAY_CLOSURE: "HOLIDAY_CLOSURE",
  TEMPORARY_CLOSURE: "TEMPORARY_CLOSURE",
  CLOSED: "CLOSED",
  PERMANENTLY_CLOSED: "PERMANENTLY_CLOSED",
  INACTIVE: "INACTIVE",
};

function result(state, { isUsable, label, reason, ...rest }) {
  return { state, isUsable: Boolean(isUsable), label, reason: reason || null, ...rest };
}

// Batch-fetch what resolveEffectiveStatus needs for every amenity in
// `amenityIds` in 2 queries total instead of up to 3 PER amenity. A list
// screen (clubhouse summary, clubhouse floor, the resident amenities list)
// calling resolveEffectiveStatus once per amenity in a loop was doing N x up
// to 3 sequential round trips - for a society with 10+ amenities that is
// 20-30 extra queries on every single load of those screens, which is most
// of what made them consistently the slowest endpoints in the app even after
// fixing the US-India region mismatch.
export async function prefetchEffectiveStatusInputs({ amenityIds, at, timezone }) {
  const now = at ? new Date(at) : new Date();
  const dow = dayOfWeek(now, timezone);
  const [maintenanceRows, closureRows, windowRows] = await Promise.all([
    AmenityMaintenance.find({
      amenityId: { $in: amenityIds },
      status: { $in: [MAINTENANCE_STATUS.SCHEDULED, MAINTENANCE_STATUS.IN_PROGRESS] },
      startDate: { $lte: now },
      endDate: { $gte: now },
    })
      .sort({ startDate: 1 })
      .lean(),
    AmenityAvailability.find({
      amenityId: { $in: amenityIds },
      type: "CLOSURE",
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
    }).lean(),
    AmenityAvailability.find({
      amenityId: { $in: amenityIds },
      type: "WEEKLY",
      dayOfWeek: dow,
      isActive: true,
    }).lean(),
  ]);

  // First match per amenity only - same "one active row wins" semantics the
  // per-amenity findOne() calls below had.
  const maintenanceByAmenity = new Map();
  for (const m of maintenanceRows) {
    const key = String(m.amenityId);
    if (!maintenanceByAmenity.has(key)) maintenanceByAmenity.set(key, m);
  }
  const closureByAmenity = new Map();
  for (const c of closureRows) {
    const key = String(c.amenityId);
    if (!closureByAmenity.has(key)) closureByAmenity.set(key, c);
  }
  const windowsByAmenity = new Map();
  for (const w of windowRows) {
    const key = String(w.amenityId);
    if (!windowsByAmenity.has(key)) windowsByAmenity.set(key, []);
    windowsByAmenity.get(key).push(w);
  }

  return {
    maintenanceFor: (amenityId) => maintenanceByAmenity.get(String(amenityId)) || null,
    closureFor: (amenityId) => closureByAmenity.get(String(amenityId)) || null,
    windowsFor: (amenityId) => windowsByAmenity.get(String(amenityId)) || [],
  };
}

export async function resolveEffectiveStatus({ amenity, at, timezone, prefetched }) {
  const now = at ? new Date(at) : new Date();

  if (amenity.isActive === false) {
    return result(EFFECTIVE.INACTIVE, {
      isUsable: false, label: "Not available",
      reason: "This amenity is not currently in service",
    });
  }
  if (amenity.status === AMENITY_STATUS.PERMANENTLY_CLOSED) {
    return result(EFFECTIVE.PERMANENTLY_CLOSED, {
      isUsable: false, label: "Permanently closed",
      reason: amenity.statusNote || "This amenity has been permanently closed",
    });
  }

  // An active maintenance record is fetched even when the manual status already
  // says UNDER_MAINTENANCE, so the resident sees the window and the reason
  // rather than a bare "closed".
  const maintenance = prefetched
    ? prefetched.maintenanceFor(amenity._id)
    : await AmenityMaintenance.findOne({
        amenityId: amenity._id,
        status: { $in: [MAINTENANCE_STATUS.SCHEDULED, MAINTENANCE_STATUS.IN_PROGRESS] },
        startDate: { $lte: now },
        endDate: { $gte: now },
      })
        .sort({ startDate: 1 })
        .lean();

  if (maintenance || amenity.status === AMENITY_STATUS.UNDER_MAINTENANCE) {
    return result(EFFECTIVE.UNDER_MAINTENANCE, {
      isUsable: false,
      label: "Under maintenance",
      reason: maintenance?.reason || amenity.statusNote || "This amenity is under maintenance",
      maintenance: maintenance
        ? { _id: maintenance._id, startDate: maintenance.startDate, endDate: maintenance.endDate, reason: maintenance.reason }
        : null,
      // What residents actually want to know: when can I use it again.
      nextOpenAt: maintenance?.endDate || null,
    });
  }

  if (amenity.status === AMENITY_STATUS.TEMPORARILY_CLOSED) {
    return result(EFFECTIVE.TEMPORARY_CLOSURE, {
      isUsable: false, label: "Temporarily closed",
      reason: amenity.statusNote || "This amenity is temporarily closed",
    });
  }
  if (amenity.status === AMENITY_STATUS.CLOSED) {
    return result(EFFECTIVE.CLOSED, {
      isUsable: false, label: "Closed",
      reason: amenity.statusNote || "This amenity is closed",
    });
  }

  // Dated closures (holidays, ad-hoc shutdowns) override the weekly grid.
  const closure = prefetched
    ? prefetched.closureFor(amenity._id)
    : await AmenityAvailability.findOne({
        amenityId: amenity._id,
        type: "CLOSURE",
        isActive: true,
        startDate: { $lte: now },
        endDate: { $gte: now },
      }).lean();

  if (closure) {
    const isHoliday = closure.closureType === CLOSURE_TYPE.HOLIDAY;
    return result(isHoliday ? EFFECTIVE.HOLIDAY_CLOSURE : EFFECTIVE.TEMPORARY_CLOSURE, {
      isUsable: false,
      label: isHoliday ? "Holiday closure" : "Temporarily closed",
      reason: closure.reason || (isHoliday ? "Closed for a holiday" : "Temporarily closed"),
      closure: { _id: closure._id, startDate: closure.startDate, endDate: closure.endDate, reason: closure.reason },
      nextOpenAt: closure.endDate,
    });
  }

  // Finally, the clock. Multiple windows per day are supported (morning and
  // evening pool sessions), so "open" means "inside any window today".
  const dow = dayOfWeek(now, timezone);
  const nowMins = minutesOfDay(now, timezone);

  const windows = prefetched
    ? prefetched.windowsFor(amenity._id)
    : await AmenityAvailability.find({
        amenityId: amenity._id,
        type: "WEEKLY",
        dayOfWeek: dow,
        isActive: true,
      }).lean();

  // No configured grid: fall back to the amenity's mirrored operating hours.
  const todayWindows = windows.length
    ? windows.map((wn) => ({ open: toMinutes(wn.openTime), close: toMinutes(wn.closeTime) }))
    : (amenity.operatingDays || []).includes(dow)
      ? [{ open: toMinutes(amenity.openingTime), close: toMinutes(amenity.closingTime) }]
      : [];

  if (!todayWindows.length) {
    return result(EFFECTIVE.CLOSED_TODAY, {
      isUsable: false,
      label: "Closed today",
      reason: `This amenity is closed on ${DAY_LABELS[dow]}s`,
    });
  }

  const current = todayWindows.find((wn) => wn.open != null && wn.close != null && nowMins >= wn.open && nowMins < wn.close);
  if (current) {
    return result(EFFECTIVE.OPEN, {
      isUsable: true,
      label: "Open",
      openUntil: fromMinutes(current.close),
    });
  }

  const upcoming = todayWindows
    .filter((wn) => wn.open != null && wn.open > nowMins)
    .sort((a, b) => a.open - b.open)[0];

  return result(EFFECTIVE.CLOSED_NOW, {
    isUsable: false,
    label: upcoming ? `Opens at ${fromMinutes(upcoming.open)}` : "Closed for the day",
    reason: upcoming
      ? `This amenity opens at ${fromMinutes(upcoming.open)} today`
      : "This amenity has closed for the day",
    nextOpenTime: upcoming ? fromMinutes(upcoming.open) : null,
  });
}

// Overlap detection for maintenance scheduling. Half-open comparison, so a
// window ending exactly when the next begins is allowed.
export async function findOverlappingMaintenance({ amenityId, startDate, endDate, excludeId }) {
  const candidates = await AmenityMaintenance.find({
    amenityId,
    status: { $in: [MAINTENANCE_STATUS.SCHEDULED, MAINTENANCE_STATUS.IN_PROGRESS] },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    startDate: { $lt: new Date(endDate) },
    endDate: { $gt: new Date(startDate) },
  })
    .select("_id startDate endDate reason status")
    .lean();

  return candidates.find((c) => rangesOverlap(startDate, endDate, c.startDate, c.endDate)) || null;
}

// The 7-row grid the admin availability editor and the resident "timings" panel
// both render. Always returns all seven days so the UI never has holes.
export async function getWeeklyGrid(amenityId, amenity) {
  const rows = await AmenityAvailability.find({ amenityId, type: "WEEKLY", isActive: true })
    .sort({ dayOfWeek: 1, openTime: 1 })
    .lean();

  return DAY_LABELS.map((label, dow) => {
    const dayRows = rows.filter((r) => r.dayOfWeek === dow);
    if (dayRows.length) {
      return {
        dayOfWeek: dow,
        day: label,
        closed: false,
        windows: dayRows.map((r) => ({ openTime: r.openTime, closeTime: r.closeTime })),
      };
    }
    // No explicit rows: mirror the amenity-level operating days.
    const openByDefault = (amenity?.operatingDays || []).includes(dow);
    return {
      dayOfWeek: dow,
      day: label,
      closed: !openByDefault,
      windows: openByDefault
        ? [{ openTime: amenity.openingTime, closeTime: amenity.closingTime }]
        : [],
    };
  });
}

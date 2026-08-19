import { withRoute, json, ApiError } from "@/lib/v1/http";
import { getClaims } from "@/lib/v1/auth";
import connectDB from "@/lib/mongodb";
import Amenity from "@/models/amenities/Amenity";
import AmenityCategory from "@/models/amenities/AmenityCategory";
import AmenityRule from "@/models/amenities/AmenityRule";
import AmenityTimeSlot from "@/models/amenities/AmenityTimeSlot";
import AmenityMaintenance from "@/models/amenities/AmenityMaintenance";
import AmenityEvent from "@/models/amenities/AmenityEvent";
import AmenityAttendance from "@/models/amenities/AmenityAttendance";
import AmenityAvailability from "@/models/amenities/AmenityAvailability";
import { memberContext, publicAmenity } from "@/lib/amenities/memberContext";
import { resolveEffectiveStatus, getWeeklyGrid } from "@/lib/amenities/availability";
import { checkEligibility } from "@/lib/amenities/permissions";
import { getTimezone } from "@/lib/amenities/settingsService";
import { dayOfWeek, minutesOfDay, dayKey, startOfDayUtc, endOfDayUtc } from "@/lib/amenities/time";
import { EVENT_STATUS, MAINTENANCE_STATUS } from "@/lib/amenities/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/amenities/:id
//
// One request backs the whole resident detail screen: status, rules, timings,
// maintenance, today's slots, upcoming events and the resident's own open
// session. Mobile connections are the constraint, so this is deliberately a
// single fan-out rather than seven chatty calls.
export const GET = withRoute(async (request, { params }) => {
  const claims = await getClaims(request);
  await connectDB();
  const ctx = await memberContext(claims, request);
  const { id } = await params;

  const amenity = await Amenity.findOne({
    _id: id,
    societyId: ctx.societyId,
    isDeleted: false,
  }).lean();
  if (!amenity) throw new ApiError(404, "Amenity not found");

  const timezone = await getTimezone(ctx.societyId);
  const now = new Date();
  const today = dayOfWeek(now, timezone);

  const [category, rules, slots, maintenance, closuresToday, events, myOpenSession, effective, weeklyGrid] = await Promise.all([
    AmenityCategory.findById(amenity.categoryId).select("name").lean(),
    AmenityRule.find({ amenityId: id, isActive: true }).sort({ kind: 1, displayOrder: 1 }).lean(),
    amenity.slotPolicy?.enabled
      ? AmenityTimeSlot.find({ amenityId: id, dayOfWeek: today, isActive: true }).sort({ startMinutes: 1 }).lean()
      : Promise.resolve([]),
    // Residents see the live window plus what is coming, not the full history.
    AmenityMaintenance.find({
      amenityId: id,
      status: { $in: [MAINTENANCE_STATUS.SCHEDULED, MAINTENANCE_STATUS.IN_PROGRESS] },
      endDate: { $gte: now },
    })
      .sort({ startDate: 1 })
      .select("startDate endDate reason status")
      .lean(),
    // A break/closure added from the clubhouse manager's own app ("Add a
    // break") only ever affected the live Open/Closed pill, for the exact
    // minutes it was active - resolveEffectiveStatus() checks it, but this
    // route never surfaced the record itself, so a resident looking at the
    // page any time other than that exact window saw nothing explaining why
    // the amenity was, or is about to be, unavailable today.
    AmenityAvailability.find({
      amenityId: id,
      type: "CLOSURE",
      isActive: true,
      startDate: { $lte: endOfDayUtc(dayKey(now, timezone), timezone) },
      endDate: { $gte: startOfDayUtc(dayKey(now, timezone), timezone) },
    })
      .sort({ startDate: 1 })
      .select("startDate endDate reason closureType allDay")
      .lean(),
    AmenityEvent.find({
      amenityId: id,
      societyId: ctx.societyId,
      status: EVENT_STATUS.PUBLISHED,
      endAt: { $gte: now },
    })
      .sort({ startAt: 1 })
      .limit(10)
      .select("title startAt endAt venue capacity registeredCount registrationRequired guestsAllowed")
      .lean(),
    AmenityAttendance.findOne({ amenityId: id, memberId: ctx.memberId, timeOut: null })
      .select("timeIn slotLabel checkInMethod")
      .lean(),
    resolveEffectiveStatus({ amenity, timezone }),
    getWeeklyGrid(id, amenity),
  ]);

  const eligibility = checkEligibility({
    amenity,
    occupancyType: ctx.occupancyType,
    role: ctx.role,
    age: ctx.age,
  });

  const nowMins = minutesOfDay(now, timezone);

  return json({
    amenity: publicAmenity({ ...amenity, categoryName: category?.name || "" }, { effective, eligibility }),
    rules: {
      rules: rules.filter((r) => r.kind === "RULE").map((r) => r.text),
      dos: rules.filter((r) => r.kind === "DO").map((r) => r.text),
      donts: rules.filter((r) => r.kind === "DONT").map((r) => r.text),
      instructions: rules.filter((r) => r.kind === "INSTRUCTION").map((r) => r.text),
    },
    weeklyGrid,
    todaySlots: slots.map((s) => ({
      _id: s._id,
      label: s.label || `${s.startTime} - ${s.endTime}`,
      startTime: s.startTime,
      endTime: s.endTime,
      capacity: s.capacity,
      // Lets the app highlight the slot the resident is standing in.
      isCurrent: nowMins >= s.startMinutes && nowMins < s.endMinutes,
      isPast: nowMins >= s.endMinutes,
    })),
    maintenance,
    todayBreaks: closuresToday.map((c) => ({
      _id: c._id,
      // HH:mm in the society's own timezone, not the server's - a raw
      // toISOString() here would repeat the exact "01:00 vs 02:00 vs 00:00"
      // drift that made the weekly-hours screen look broken.
      startTime: new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(c.startDate)),
      endTime: new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(c.endDate)),
      reason: c.reason || "",
      isHoliday: c.closureType === "HOLIDAY",
    })),
    upcomingEvents: events,
    // Drives the single primary button: "Check in" or "Check out".
    myOpenSession,
    canCheckIn: effective.isUsable && eligibility.eligible && !myOpenSession,
  });
});

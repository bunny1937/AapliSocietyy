import { withRoute, json } from "@/lib/v1/http";
import connectDB from "@/lib/mongodb";
import Amenity from "@/models/amenities/Amenity";
import AmenityAttendance from "@/models/amenities/AmenityAttendance";
import AmenityMaintenance from "@/models/amenities/AmenityMaintenance";
import AmenityIncident from "@/models/amenities/AmenityIncident";
import AmenityTimeSlot from "@/models/amenities/AmenityTimeSlot";
import { Notice } from "@/lib/v1/models";
import { clubhouseContext, clubhouseCapabilities } from "@/lib/amenities/clubhouseContext";
import { CAPABILITY } from "@/lib/amenities/permissions";
import { capacitySnapshot } from "@/lib/amenities/attendanceService";
import { resolveEffectiveStatus, EFFECTIVE } from "@/lib/amenities/availability";
import { getTimezone } from "@/lib/amenities/settingsService";
import { dayKey, dayOfWeek, minutesOfDay, startOfDayUtc } from "@/lib/amenities/time";
import { MAINTENANCE_STATUS, INCIDENT_STATUS } from "@/lib/amenities/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/clubhouse/summary
//
// The Home tab, in one round trip. It answers exactly the questions a manager
// has while unlocking the clubhouse: what is open, who is inside, what is out of
// service, what is happening next, anything the society announced.
//
// It is a shift briefing, not an analytics page: counts and current state only.
// No charts, no trends, no exports — those stay on the Admin website, where the
// history and the screen size for them already exist.
//
// Not cached. Everything here is "right now", and a 30s-stale occupancy number
// at a capacity-controlled pool is worse than no number.
export const GET = withRoute(async (request) => {
  const ctx = await clubhouseContext(request, CAPABILITY.VIEW_AMENITIES);
  await connectDB();

  const timezone = await getTimezone(ctx.societyId);
  const now = new Date();
  const today = dayKey(now, timezone);
  const dow = dayOfWeek(now, timezone);
  const nowMins = minutesOfDay(now, timezone);

  const [amenities, insideRows, todayRows, maintenance, openIncidents, notices] =
    await Promise.all([
      Amenity.find({ societyId: ctx.societyId, isDeleted: false, isActive: true })
        .select("name categoryId status statusNote capacity liveOccupancy openingTime closingTime operatingDays slotPolicy activeMaintenanceId")
        .sort({ displayOrder: 1, name: 1 })
        .lean(),
      AmenityAttendance.find({ societyId: ctx.societyId, timeOut: null })
        .select("amenityId amenityName residentName flatNo timeIn slotLabel")
        .sort({ timeIn: -1 })
        .lean(),
      // Today's footfall: every session that STARTED today, closed or not. Using
      // dayKey (the module's local-day grain) rather than a UTC range keeps a
      // 1am session filed under the right day.
      AmenityAttendance.countDocuments({ societyId: ctx.societyId, dayKey: today }),
      AmenityMaintenance.find({
        societyId: ctx.societyId,
        status: { $in: [MAINTENANCE_STATUS.IN_PROGRESS, MAINTENANCE_STATUS.SCHEDULED] },
        endDate: { $gte: startOfDayUtc(today, timezone) },
      })
        .select("amenityId reason status startDate endDate isEmergency")
        .sort({ startDate: 1 })
        .lean(),
      AmenityIncident.countDocuments({
        societyId: ctx.societyId,
        status: { $in: [INCIDENT_STATUS.OPEN, INCIDENT_STATUS.IN_PROGRESS] },
      }),
      Notice.find({ societyId: ctx.societyId, isDeleted: { $ne: true } })
        .sort({ pinned: -1, createdAt: -1 })
        .limit(3)
        .select("title priority createdAt pinned")
        .lean(),
    ]);

  const insideByAmenity = new Map();
  for (const row of insideRows) {
    const key = String(row.amenityId);
    insideByAmenity.set(key, (insideByAmenity.get(key) || 0) + 1);
  }
  const maintenanceByAmenity = new Map(maintenance.map((m) => [String(m.amenityId), m]));

  const amenityIds = amenities.map((a) => a._id);
  // The remaining slots of today, across the clubhouse: what the manager is
  // about to have to open a court for.
  const upcomingSlots = await AmenityTimeSlot.find({
    amenityId: { $in: amenityIds },
    dayOfWeek: dow,
    isActive: true,
    endMinutes: { $gt: nowMins },
  })
    .sort({ startMinutes: 1 })
    .limit(8)
    .select("amenityId startTime endTime startMinutes endMinutes label")
    .lean();

  const nameById = new Map(amenities.map((a) => [String(a._id), a.name]));

  const cards = await Promise.all(
    amenities.map(async (a) => {
      const effective = await resolveEffectiveStatus({ amenity: a, at: now, timezone });
      const capacity = capacitySnapshot(a);
      return {
        _id: a._id,
        name: a.name,
        categoryId: a.categoryId,
        status: a.status,
        statusNote: a.statusNote || "",
        effective,
        // maxOccupancy is sent for display and never accepted back: this route
        // is read-only and no clubhouse route writes capacity at all.
        capacity: { ...capacity, current: insideByAmenity.get(String(a._id)) || capacity.current },
        openingTime: a.openingTime,
        closingTime: a.closingTime,
        underMaintenance: maintenanceByAmenity.has(String(a._id)),
      };
    }),
  );

  const openNow = cards.filter((c) => c.effective.isUsable);

  return json({
    at: now,
    timezone,
    dayKey: today,
    capabilities: clubhouseCapabilities(ctx),
    clubhouse: {
      // "Open" for the clubhouse as a whole is derived from its amenities —
      // there is no separate clubhouse open/closed record to fall out of sync.
      isOpen: openNow.length > 0,
      amenitiesTotal: cards.length,
      amenitiesOpen: openNow.length,
      amenitiesClosed: cards.length - openNow.length,
      insideNow: insideRows.length,
      visitsToday: todayRows,
      maintenanceActive: maintenance.filter((m) => m.status === MAINTENANCE_STATUS.IN_PROGRESS).length,
      maintenanceScheduled: maintenance.filter((m) => m.status === MAINTENANCE_STATUS.SCHEDULED).length,
      openIncidents,
    },
    amenities: cards,
    // A short live list, not the Attendance tab: enough to recognise the room.
    recentCheckIns: insideRows.slice(0, 6).map((r) => ({
      attendanceId: r._id,
      amenityId: r.amenityId,
      amenityName: r.amenityName,
      memberName: r.residentName,
      flatLabel: r.flatNo,
      slotLabel: r.slotLabel || "",
      timeIn: r.timeIn,
    })),
    maintenanceAlerts: maintenance.slice(0, 5).map((m) => ({
      _id: m._id,
      amenityId: m.amenityId,
      amenityName: nameById.get(String(m.amenityId)) || "",
      reason: m.reason,
      status: m.status,
      startDate: m.startDate,
      endDate: m.endDate,
      isEmergency: !!m.isEmergency,
    })),
    upcomingSlots: upcomingSlots.map((s) => ({
      _id: s._id,
      amenityId: s.amenityId,
      amenityName: nameById.get(String(s.amenityId)) || "",
      startTime: s.startTime,
      endTime: s.endTime,
      label: s.label || "",
      // "current" is the slot in progress; the app leads with it rather than
      // making the manager compare times.
      current: s.startMinutes <= nowMins && s.endMinutes > nowMins,
    })),
    notices: notices.map((n) => ({
      _id: n._id,
      title: n.title,
      priority: n.priority,
      pinned: !!n.pinned,
      createdAt: n.createdAt,
    })),
  });
});

import { withRoute, json } from "@/lib/v1/http";
import connectDB from "@/lib/mongodb";
import Amenity from "@/models/amenities/Amenity";
import AmenityCategory from "@/models/amenities/AmenityCategory";
import AmenityAttendance from "@/models/amenities/AmenityAttendance";
import AmenityTimeSlot from "@/models/amenities/AmenityTimeSlot";
import { clubhouseContext, clubhouseCapabilities } from "@/lib/amenities/clubhouseContext";
import { CAPABILITY } from "@/lib/amenities/permissions";
import { capacitySnapshot } from "@/lib/amenities/attendanceService";
import { resolveEffectiveStatus } from "@/lib/amenities/availability";
import { getTimezone } from "@/lib/amenities/settingsService";
import { dayOfWeek, minutesOfDay } from "@/lib/amenities/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/clubhouse/amenities?amenityId=
//
// The Amenities tab. Existing amenities only — there is no create and no delete
// anywhere in this environment, by decision: an amenity appearing or
// disappearing is a configuration act that belongs to the Admin website.
//
// With ?amenityId= it returns the single amenity plus the rest of today's slot
// grid, which is what the amenity sheet opens with.
//
// Slots are returned in FULL: past, full, and unavailable ones included, each
// with its own status. A manager being shown only bookable slots cannot answer
// "is the 7pm court free?" — which is most of the question they get asked.
export const GET = withRoute(async (request) => {
  const ctx = await clubhouseContext(request, CAPABILITY.VIEW_AMENITIES);
  await connectDB();

  const sp = new URL(request.url).searchParams;
  const amenityId = sp.get("amenityId");
  const single = amenityId && /^[a-f\d]{24}$/i.test(amenityId);

  const timezone = await getTimezone(ctx.societyId);
  const now = new Date();
  const dow = dayOfWeek(now, timezone);
  const nowMins = minutesOfDay(now, timezone);

  const filter = { societyId: ctx.societyId, isDeleted: false, isActive: true };
  if (single) filter._id = amenityId;

  const [rows, categories] = await Promise.all([
    Amenity.find(filter).sort({ displayOrder: 1, name: 1 }).lean(),
    AmenityCategory.find({ societyId: ctx.societyId, isDeleted: false, isActive: true })
      .select("name icon color displayOrder")
      .sort({ displayOrder: 1, name: 1 })
      .lean(),
  ]);
  if (single && !rows.length) return json({ error: "Amenity not found" }, { status: 404 });

  const ids = rows.map((r) => r._id);
  const [inside, slots] = await Promise.all([
    AmenityAttendance.aggregate([
      { $match: { amenityId: { $in: ids }, timeOut: null } },
      { $group: { _id: "$amenityId", count: { $sum: 1 }, slots: { $push: "$slotId" } } },
    ]),
    // Only the requested amenity's slots are fetched in single mode; the list
    // view needs the current/next slot only, so it never pulls a full grid for
    // every amenity in the society.
    AmenityTimeSlot.find({
      amenityId: { $in: ids },
      dayOfWeek: dow,
      isActive: true,
      ...(single ? {} : { endMinutes: { $gt: nowMins } }),
    })
      .sort({ startMinutes: 1 })
      .lean(),
  ]);

  const insideById = new Map(inside.map((i) => [String(i._id), i]));
  const slotsById = new Map();
  for (const s of slots) {
    const key = String(s.amenityId);
    if (!slotsById.has(key)) slotsById.set(key, []);
    slotsById.get(key).push(s);
  }

  const amenities = await Promise.all(
    rows.map(async (a) => {
      const effective = await resolveEffectiveStatus({ amenity: a, at: now, timezone });
      const insideInfo = insideById.get(String(a._id));
      const capacity = capacitySnapshot(a);
      const current = insideInfo?.count || 0;

      // Per-slot occupancy from the open sessions attached to each slot, so a
      // "full" slot badge means the court is actually full right now.
      const perSlot = new Map();
      for (const sid of insideInfo?.slots || []) {
        if (!sid) continue;
        perSlot.set(String(sid), (perSlot.get(String(sid)) || 0) + 1);
      }

      const daySlots = (slotsById.get(String(a._id)) || []).map((s) => {
        const slotCap = s.capacity ?? (capacity.unlimited ? null : capacity.maxOccupancy);
        const used = perSlot.get(String(s._id)) || 0;
        const past = s.endMinutes <= nowMins;
        const isCurrent = s.startMinutes <= nowMins && s.endMinutes > nowMins;
        const full = slotCap != null && used >= slotCap;
        return {
          _id: s._id,
          startTime: s.startTime,
          endTime: s.endTime,
          label: s.label || `${s.startTime} – ${s.endTime}`,
          capacity: slotCap,
          used,
          // One explicit status per slot rather than three booleans the client has
          // to reason about. PAST and FULL slots are still returned — they are
          // information, not noise.
          status: past ? "PAST" : full ? "FULL" : isCurrent ? "CURRENT" : "UPCOMING",
          selectable: !past && !full && effective.isUsable,
        };
      });

      return {
        _id: a._id,
        name: a.name,
        description: a.description || "",
        location: a.location || "",
        categoryId: a.categoryId,
        status: a.status,
        statusNote: a.statusNote || "",
        statusChangedAt: a.statusChangedAt,
        effective,
        capacity: { ...capacity, current },
        // Stated, not implied: the app renders capacity as a fixed figure and has
        // no editor for it.
        capacityEditable: false,
        openingTime: a.openingTime,
        closingTime: a.closingTime,
        operatingDays: a.operatingDays || [],
        attendanceMode: a.attendanceMode,
        slotsEnabled: !!a.slotPolicy?.enabled,
        slotDurationMins: a.slotPolicy?.slotDurationMins || null,
        underMaintenance: !!a.activeMaintenanceId,
        activeMaintenanceId: a.activeMaintenanceId || null,
        slots: daySlots,
        currentSlot: daySlots.find((s) => s.status === "CURRENT") || null,
        nextSlot: daySlots.find((s) => s.status === "UPCOMING") || null,
      };
    }),
  );

  return json({
    capabilities: clubhouseCapabilities(ctx),
    categories: categories.map((c) => ({ _id: c._id, name: c.name, icon: c.icon || "", color: c.color || "" })),
    amenities,
    ...(single ? { amenity: amenities[0] } : {}),
  });
});

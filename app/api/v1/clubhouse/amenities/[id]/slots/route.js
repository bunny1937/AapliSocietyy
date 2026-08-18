import { withRoute, json } from "@/lib/v1/http";
import connectDB from "@/lib/mongodb";
import { z } from "zod";
import Amenity from "@/models/amenities/Amenity";
import AmenityTimeSlot from "@/models/amenities/AmenityTimeSlot";
import AmenityAttendance from "@/models/amenities/AmenityAttendance";
import { clubhouseContext } from "@/lib/amenities/clubhouseContext";
import { CAPABILITY } from "@/lib/amenities/permissions";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { getTimezone } from "@/lib/amenities/settingsService";
import { dayOfWeek, minutesOfDay } from "@/lib/amenities/time";
import { ACTIVITY_ACTION } from "@/lib/amenities/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  slotId: z.string().regex(/^[a-f\d]{24}$/i),
  // Take a single slot out of service, or put it back. NOT a slot editor: slot
  // duration, gaps and per-slot capacity are policy and stay on the website.
  isActive: z.boolean(),
  reason: z.string().trim().max(300).optional(),
});

// GET /api/v1/clubhouse/amenities/[id]/slots?day=
//
// The whole day's grid for one amenity, every slot with a status. Nothing is
// filtered out — past, current, full and blocked slots are all returned,
// because the manager is answering questions about all of them.
export const GET = withRoute(async (request, { params }) => {
  const ctx = await clubhouseContext(request, CAPABILITY.VIEW_AMENITIES);
  await connectDB();

  const { id } = await params;
  const amenity = await Amenity.findOne({ _id: id, societyId: ctx.societyId, isDeleted: false })
    .select("name capacity slotPolicy")
    .lean();
  if (!amenity) return json({ error: "Amenity not found" }, { status: 404 });

  const timezone = await getTimezone(ctx.societyId);
  const now = new Date();
  const sp = new URL(request.url).searchParams;
  const dayParam = Number(sp.get("day"));
  const dow = Number.isInteger(dayParam) && dayParam >= 0 && dayParam <= 6 ? dayParam : dayOfWeek(now, timezone);
  const isToday = dow === dayOfWeek(now, timezone);
  const nowMins = minutesOfDay(now, timezone);

  const [slots, openSessions] = await Promise.all([
    AmenityTimeSlot.find({ amenityId: id, dayOfWeek: dow }).sort({ startMinutes: 1 }).lean(),
    AmenityAttendance.find({ amenityId: id, timeOut: null }).select("slotId").lean(),
  ]);

  const used = new Map();
  for (const s of openSessions) {
    if (!s.slotId) continue;
    used.set(String(s.slotId), (used.get(String(s.slotId)) || 0) + 1);
  }
  const fallbackCap = amenity.capacity?.unlimited ? null : amenity.capacity?.maxOccupancy ?? null;

  return json({
    amenity: { _id: amenity._id, name: amenity.name },
    dayOfWeek: dow,
    slotsEnabled: !!amenity.slotPolicy?.enabled,
    slots: slots.map((s) => {
      const cap = s.capacity ?? fallbackCap;
      const inUse = used.get(String(s._id)) || 0;
      const past = isToday && s.endMinutes <= nowMins;
      const current = isToday && s.startMinutes <= nowMins && s.endMinutes > nowMins;
      const full = cap != null && inUse >= cap;
      return {
        _id: s._id,
        startTime: s.startTime,
        endTime: s.endTime,
        label: s.label || `${s.startTime} – ${s.endTime}`,
        capacity: cap,
        used: inUse,
        isActive: s.isActive,
        isCustom: !!s.isCustom,
        status: !s.isActive ? "BLOCKED" : past ? "PAST" : full ? "FULL" : current ? "CURRENT" : "UPCOMING",
        selectable: s.isActive && !past && !full,
      };
    }),
  });
});

// PATCH /api/v1/clubhouse/amenities/[id]/slots
//
// Block or unblock one slot ("court 2 booked for coaching at 6").
export const PATCH = withRoute(async (request, { params }) => {
  const ctx = await clubhouseContext(request, CAPABILITY.MANAGE_SLOTS);
  await connectDB();

  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return json({ error: parsed.error.flatten() }, { status: 400 });

  const amenity = await Amenity.findOne({ _id: id, societyId: ctx.societyId, isDeleted: false })
    .select("name")
    .lean();
  if (!amenity) return json({ error: "Amenity not found" }, { status: 404 });

  const slot = await AmenityTimeSlot.findOne({ _id: parsed.data.slotId, amenityId: id }).lean();
  if (!slot) return json({ error: "That slot is no longer there." }, { status: 404 });

  // Blocking a slot people are currently inside would leave live sessions
  // attached to an inactive window. Refuse and say so.
  if (!parsed.data.isActive) {
    const inside = await AmenityAttendance.countDocuments({ amenityId: id, slotId: slot._id, timeOut: null });
    if (inside) {
      return json(
        { error: `${inside} ${inside === 1 ? "person is" : "people are"} inside for this slot. Check them out first.`, code: "SLOT_IN_USE" },
        { status: 409 },
      );
    }
  }

  const updated = await AmenityTimeSlot.findByIdAndUpdate(
    slot._id,
    { $set: { isActive: parsed.data.isActive } },
    { new: true },
  ).lean();

  await logAmenityActivity({
    societyId: ctx.societyId,
    entityType: "SLOT",
    entityId: slot._id,
    amenityId: id,
    amenityName: amenity.name,
    action: ACTIVITY_ACTION.SLOTS_REGENERATED,
    actor: ctx.actor,
    oldValue: { isActive: slot.isActive },
    newValue: { isActive: parsed.data.isActive, slot: `${slot.startTime}–${slot.endTime}`, via: "CLUBHOUSE" },
    changedFields: ["isActive"],
    note: parsed.data.reason || (parsed.data.isActive ? "Slot reopened" : "Slot blocked"),
  });

  return json({ ok: true, slot: updated });
});

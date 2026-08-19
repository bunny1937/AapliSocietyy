import { z } from "zod";
import { withRoute, json } from "@/lib/v1/http";
import connectDB from "@/lib/mongodb";
import Amenity from "@/models/amenities/Amenity";
import AmenityAvailability from "@/models/amenities/AmenityAvailability";
import { clubhouseContext } from "@/lib/amenities/clubhouseContext";
import { CAPABILITY } from "@/lib/amenities/permissions";
import { CLOSURE_TYPE, ACTIVITY_ACTION } from "@/lib/amenities/constants";
import { getTimezone } from "@/lib/amenities/settingsService";
import { isHHmm, toMinutes, dayKey, dayOfWeek, startOfDayUtc, addMinutes } from "@/lib/amenities/time";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import cache from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/v1/clubhouse/amenities/[id]/timings
//
// The mobile counterpart of clubhouse_amenity_sheet.dart's "Change opening
// hours" / "Add a break" rows — the Flutter screen and its ClubhouseApi
// client already existed and called this exact path; the route itself was
// never written, so every tap 404'd (surfaced in the app as a generic
// failure toast).
//
//   action: "timings" - overwrites the amenity's blanket openingTime/
//           closingTime (the same fields PATCH /api/amenities/[id] writes)
//           AND today's own row in the per-weekday AmenityAvailability grid,
//           the same two places the website's weekly-hours editor (PUT
//           /api/amenities/[id]/availability) keeps in sync on every save.
//           The other six days of that grid are untouched - this is the
//           one-line "we open at 7 not 6 from today" edit a manager makes
//           standing at the desk, not a rewrite of the whole week (that
//           stays website-only, Manage Access permitting).
//   action: "break"   - a same-day partial closure (AmenityAvailability,
//           type CLOSURE, allDay:false), the same record type the website's
//           Closures panel creates. Scoped to TODAY only, in the society's
//           timezone - there is no "recurring break" concept, matching what
//           the Flutter sheet's copy promises ("Closes for part of today").
const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("timings"),
    openingTime: z.string().refine(isHHmm, "openingTime must be HH:mm"),
    closingTime: z.string().refine(isHHmm, "closingTime must be HH:mm"),
  }),
  z.object({
    action: z.literal("break"),
    startTime: z.string().refine(isHHmm, "startTime must be HH:mm"),
    endTime: z.string().refine(isHHmm, "endTime must be HH:mm"),
    reason: z.string().trim().min(3).max(300),
  }),
]);

export const POST = withRoute(async (request, { params }) => {
  const ctx = await clubhouseContext(request, CAPABILITY.MANAGE_AVAILABILITY);
  await connectDB();
  const { id } = await params;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return json({ error: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;

  const amenity = await Amenity.findOne({ _id: id, societyId: ctx.societyId, isDeleted: false }).lean();
  if (!amenity) return json({ error: "Amenity not found" }, { status: 404 });

  if (body.action === "timings") {
    if (toMinutes(body.closingTime) <= toMinutes(body.openingTime)) {
      return json({ error: "Closing time must be after opening time." }, { status: 422 });
    }

    const updated = await Amenity.findByIdAndUpdate(
      id,
      {
        $set: {
          openingTime: body.openingTime,
          closingTime: body.closingTime,
          updatedBy: ctx.userId,
        },
      },
      { new: true },
    ).lean();

    // The website's own weekly-hours editor (PUT /api/amenities/[id]/
    // availability) keeps these blanket fields and the per-weekday
    // AmenityAvailability grid in sync on every save. This quick edit only
    // ever touched the blanket fields, so a manager changing hours from the
    // app would silently diverge from what the detail page's "Weekly hours"
    // (built from that same grid) shows for today - the exact drift that
    // made the two screens disagree. Keep TODAY's row in step; the other six
    // days are unaffected, matching what this action's own copy promises
    // ("Change opening hours" - not "rewrite the week").
    const timezone = await getTimezone(ctx.societyId);
    const todayDow = dayOfWeek(new Date(), timezone);
    await AmenityAvailability.deleteMany({ amenityId: id, type: "WEEKLY", dayOfWeek: todayDow });
    await AmenityAvailability.create({
      societyId: ctx.societyId,
      amenityId: id,
      type: "WEEKLY",
      dayOfWeek: todayDow,
      openTime: body.openingTime,
      closeTime: body.closingTime,
      isActive: true,
      createdBy: ctx.userId,
    });

    await logAmenityActivity({
      societyId: ctx.societyId,
      entityType: "AMENITY",
      entityId: id,
      amenityId: id,
      amenityName: amenity.name,
      action: ACTIVITY_ACTION.AMENITY_UPDATED,
      actor: ctx.actor,
      oldValue: { openingTime: amenity.openingTime, closingTime: amenity.closingTime },
      newValue: { openingTime: updated.openingTime, closingTime: updated.closingTime, via: "CLUBHOUSE" },
      changedFields: ["openingTime", "closingTime"],
    });

    // The resident list (GET /v1/amenities) caches this society's rows for
    // up to 120s (stale-while-revalidate, by design for load). Without this
    // bust, the list card and this amenity's own detail page (uncached)
    // would legitimately disagree for up to two minutes after every manager
    // edit — exactly the "why do these two screens show different hours"
    // confusion that shows up hardest during back-to-back testing.
    await cache.del(`v1:amenities:${ctx.societyId}`);

    return json({ ok: true, amenity: updated });
  }

  // break — a same-day-only closure window.
  if (toMinutes(body.endTime) <= toMinutes(body.startTime)) {
    return json({ error: "The break must end after it starts." }, { status: 422 });
  }

  const timezone = await getTimezone(ctx.societyId);
  const today = dayKey(new Date(), timezone);
  const dayStart = startOfDayUtc(today, timezone);
  const start = addMinutes(dayStart, toMinutes(body.startTime));
  const end = addMinutes(dayStart, toMinutes(body.endTime));

  const closure = await AmenityAvailability.create({
    societyId: ctx.societyId,
    amenityId: id,
    type: "CLOSURE",
    closureType: CLOSURE_TYPE.TEMPORARY,
    startDate: start,
    endDate: end,
    reason: body.reason,
    allDay: false,
    isActive: true,
    createdBy: ctx.userId,
  });

  await logAmenityActivity({
    societyId: ctx.societyId,
    entityType: "AVAILABILITY",
    entityId: closure._id,
    amenityId: id,
    amenityName: amenity.name,
    action: ACTIVITY_ACTION.CLOSURE_ADDED,
    actor: ctx.actor,
    newValue: { startDate: start, endDate: end, reason: body.reason, via: "CLUBHOUSE" },
  });

  // Same reasoning as the timings branch above - a break changes what the
  // list's cached "Open"/effective status shows too.
  await cache.del(`v1:amenities:${ctx.societyId}`);

  return json({ ok: true, closure });
});

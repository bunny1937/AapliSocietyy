import { z } from "zod";
import { withRoute, json } from "@/lib/v1/http";
import connectDB from "@/lib/mongodb";
import Amenity from "@/models/amenities/Amenity";
import AmenityAvailability from "@/models/amenities/AmenityAvailability";
import { clubhouseContext } from "@/lib/amenities/clubhouseContext";
import { CAPABILITY } from "@/lib/amenities/permissions";
import { CLOSURE_TYPE, ACTIVITY_ACTION } from "@/lib/amenities/constants";
import { getTimezone } from "@/lib/amenities/settingsService";
import { isHHmm, toMinutes, dayKey, startOfDayUtc, addMinutes } from "@/lib/amenities/time";
import { logAmenityActivity } from "@/lib/amenities/activityLog";

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
//           closingTime, the same fields the website's amenity edit form
//           writes via PATCH /api/amenities/[id]. Deliberately NOT the
//           per-weekday AmenityAvailability rows (that editor is website-
//           only, Manage Access permitting) - this is the one-line "we open
//           at 7 not 6 from today" edit a manager makes standing at the desk.
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

  return json({ ok: true, closure });
});

import Amenity from "@/models/amenities/Amenity";
import AmenityAvailability from "@/models/amenities/AmenityAvailability";
import { closureCreateSchema } from "@/lib/amenities/schemas";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION, CLOSURE_TYPE } from "@/lib/amenities/constants";
import { notifyStatusChanged } from "@/lib/amenities/notify";
import { rangesOverlap } from "@/lib/amenities/time";
import { CAPABILITY, gate, ok, created, fail, zodFail, isId, withAmenityRoute } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/amenities/[id]/closures?upcoming=true
export const GET = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.VIEW_AMENITIES);
  if (!g.ok) return g.response;

  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid amenity id");

  const { searchParams } = new URL(request.url);
  const filter = { amenityId: id, type: "CLOSURE", isActive: true };
  if (searchParams.get("upcoming") === "true") filter.endDate = { $gte: new Date() };
  if (searchParams.get("closureType")) filter.closureType = searchParams.get("closureType");

  const closures = await AmenityAvailability.find(filter).sort({ startDate: 1 }).lean();
  return ok({ closures, total: closures.length });
});

// POST /api/amenities/[id]/closures
//
// Holiday and temporary closures are dated exceptions that override the weekly
// grid. Kept separate from maintenance on purpose: a Diwali closure is not a
// maintenance event and should not appear in the maintenance-downtime metric.
export const POST = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.MANAGE_AVAILABILITY);
  if (!g.ok) return g.response;

  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid amenity id");

  const parsed = closureCreateSchema.safeParse(await request.json());
  if (!parsed.success) return zodFail(parsed);
  const { closureType, startDate, endDate, reason, allDay = true, notify = true } = parsed.data;

  const amenity = await Amenity.findOne({ _id: id, societyId: g.societyId, isDeleted: false }).lean();
  if (!amenity) return fail(404, "Amenity not found");

  const start = new Date(startDate);
  const end = new Date(endDate);

  // Two overlapping closures would show residents two contradictory reasons for
  // the same day.
  const existing = await AmenityAvailability.find({
    amenityId: id, type: "CLOSURE", isActive: true,
    startDate: { $lte: end }, endDate: { $gte: start },
  }).lean();
  const clash = existing.find((c) =>
    rangesOverlap(start, end, new Date(c.startDate), new Date(c.endDate)));
  if (clash) {
    return fail(409,
      `That overlaps an existing closure (${new Date(clash.startDate).toDateString()} – ${new Date(clash.endDate).toDateString()}: ${clash.reason}).`,
      { conflictId: clash._id });
  }

  const closure = await AmenityAvailability.create({
    societyId: g.societyId,
    amenityId: id,
    type: "CLOSURE",
    closureType,
    startDate: start,
    endDate: end,
    reason,
    allDay,
    isActive: true,
    createdBy: g.actor.userId,
  });

  // Residents are told only about closures that are current or imminent. A
  // holiday eight months out does not need a push notification today — it will
  // surface on the amenity page and in the maintenance calendar.
  const startsWithinAWeek = start.getTime() - Date.now() < 7 * 86400000;
  if (notify && startsWithinAWeek) {
    await notifyStatusChanged({
      societyId: g.societyId,
      amenity,
      status: amenity.status,
      note: `${closureType === CLOSURE_TYPE.HOLIDAY ? "Holiday closure" : "Temporary closure"}: ${reason} (${start.toDateString()} – ${end.toDateString()})`,
      actor: g.actor,
    });
  }

  await logAmenityActivity({
    societyId: g.societyId,
    entityType: "AVAILABILITY",
    entityId: closure._id,
    amenityId: id,
    amenityName: amenity.name,
    action: ACTIVITY_ACTION.CLOSURE_ADDED,
    actor: g.actor,
    newValue: { closureType, startDate: start, endDate: end, reason },
  });

  return created({ closure, notified: notify && startsWithinAWeek });
});

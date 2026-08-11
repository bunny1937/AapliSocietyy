import Amenity from "@/models/amenities/Amenity";
import AmenityEvent from "@/models/amenities/AmenityEvent";
import { eventCreateSchema } from "@/lib/amenities/schemas";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION, EVENT_STATUS } from "@/lib/amenities/constants";
import { notifyEventCreated } from "@/lib/amenities/notify";
import { assertFeature, getTimezone } from "@/lib/amenities/settingsService";
import { resolveEffectiveStatus } from "@/lib/amenities/availability";
import {
  gate, ok, created, fail, zodFail, isId, paging, pageMeta,
  withAmenityRoute, CAPABILITY,
} from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/amenities/events?amenityId=&status=&scope=upcoming|today|past&from=&to=
export const GET = withAmenityRoute(async (request) => {
  const g = await gate(request, CAPABILITY.VIEW_AMENITIES);
  if (!g.ok) return g.response;

  const sp = new URL(request.url).searchParams;
  const { page, limit, skip } = paging(sp);

  const filter = { societyId: g.societyId };
  if (isId(sp.get("amenityId"))) filter.amenityId = sp.get("amenityId");
  if (sp.get("status")) filter.status = sp.get("status");

  const now = new Date();
  const scope = sp.get("scope") || "upcoming";
  let sort = { startAt: 1 };
  if (scope === "upcoming") {
    filter.endAt = { $gte: now };
  } else if (scope === "today") {
    // Guards need "today's events" as a first-class view at the gate.
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now);
    dayEnd.setHours(23, 59, 59, 999);
    filter.startAt = { $lte: dayEnd };
    filter.endAt = { $gte: dayStart };
  } else if (scope === "past") {
    filter.endAt = { $lt: now };
    sort = { startAt: -1 };
  } else if (sp.get("from") && sp.get("to")) {
    filter.startAt = { $lte: new Date(sp.get("to")) };
    filter.endAt = { $gte: new Date(sp.get("from")) };
  }

  const [events, total] = await Promise.all([
    AmenityEvent.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    AmenityEvent.countDocuments(filter),
  ]);

  return ok({ events, pagination: pageMeta({ page, limit, total }), scope });
});

// POST /api/amenities/events
export const POST = withAmenityRoute(async (request) => {
  const g = await gate(request, CAPABILITY.MANAGE_EVENTS);
  if (!g.ok) return g.response;

  try {
    await assertFeature(g.societyId, "events");
  } catch (err) {
    return fail(409, err.message);
  }

  const parsed = eventCreateSchema.safeParse(await request.json());
  if (!parsed.success) return zodFail(parsed);

  const amenity = await Amenity.findOne({
    _id: parsed.data.amenityId,
    societyId: g.societyId,
    isDeleted: false,
  }).lean();
  if (!amenity) return fail(404, "Amenity not found");

  const startAt = new Date(parsed.data.startAt);
  const endAt = new Date(parsed.data.endAt);

  // Double-booking the venue is the single most common event mistake, so it is
  // blocked rather than warned about.
  const clash = await AmenityEvent.findOne({
    amenityId: amenity._id,
    status: { $in: [EVENT_STATUS.DRAFT, EVENT_STATUS.PUBLISHED] },
    startAt: { $lt: endAt },
    endAt: { $gt: startAt },
  })
    .select("title startAt endAt")
    .lean();
  if (clash) {
    return fail(409, `"${clash.title}" is already booked at ${amenity.name} during that time`, {
      conflictId: String(clash._id),
    });
  }

  // Scheduling into a maintenance window or onto a closed amenity is refused
  // unless the organiser explicitly acknowledges it.
  if (!parsed.data.ignoreAvailability) {
    const timezone = await getTimezone(g.societyId);
    const effective = await resolveEffectiveStatus({ amenity, at: startAt, timezone });
    if (!effective.isUsable) {
      return fail(409, `${amenity.name} is not available then (${effective.label}). Resolve that first, or resubmit with ignoreAvailability.`, {
        effective,
      });
    }
  }

  // An event capped above the room's occupancy limit would let registration
  // exceed what the venue can physically hold.
  if (
    parsed.data.capacity &&
    amenity.capacity &&
    amenity.capacity.unlimited === false &&
    amenity.capacity.maxOccupancy &&
    parsed.data.capacity > amenity.capacity.maxOccupancy
  ) {
    return fail(422, `${amenity.name} holds a maximum of ${amenity.capacity.maxOccupancy} people`);
  }

  const event = await AmenityEvent.create({
    ...parsed.data,
    societyId: g.societyId,
    amenityName: amenity.name,
    venue: parsed.data.venue || amenity.location || amenity.name,
    startAt,
    endAt,
    status: parsed.data.status || EVENT_STATUS.PUBLISHED,
    createdBy: g.actor.userId,
    createdByName: g.actor.name,
  });

  await logAmenityActivity({
    societyId: g.societyId,
    entityType: "EVENT",
    entityId: event._id,
    amenityId: amenity._id,
    amenityName: amenity.name,
    action: ACTIVITY_ACTION.EVENT_CREATED,
    actor: g.actor,
    newValue: { title: event.title, startAt: event.startAt, capacity: event.capacity, status: event.status },
  });

  // Drafts stay silent until published.
  if (event.status === EVENT_STATUS.PUBLISHED && parsed.data.notify !== false) {
    await notifyEventCreated({ societyId: g.societyId, amenity, event: event.toObject(), actor: g.actor });
  }

  return created({ event });
});

import AmenityEvent from "@/models/amenities/AmenityEvent";
import AmenityEventRegistration from "@/models/amenities/AmenityEventRegistration";
import AmenityWaitlist from "@/models/amenities/AmenityWaitlist";
import Amenity from "@/models/amenities/Amenity";
import { eventUpdateSchema } from "@/lib/amenities/schemas";
import { logAmenityActivity, logUpdate } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION, EVENT_STATUS, REGISTRATION_STATUS } from "@/lib/amenities/constants";
import { notifyEventUpdated, notifyEventCreated } from "@/lib/amenities/notify";
import { cancelEvent } from "@/lib/amenities/eventService";
import { promoteFromWaitlist } from "@/lib/amenities/waitlistService";
import { getSettings } from "@/lib/amenities/settingsService";
import { gate, ok, fail, zodFail, isId, withAmenityRoute, CAPABILITY } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.VIEW_AMENITIES);
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid event id");

  const event = await AmenityEvent.findOne({ _id: id, societyId: g.societyId }).lean();
  if (!event) return fail(404, "Event not found");

  const [registrations, waitlist] = await Promise.all([
    AmenityEventRegistration.find({ eventId: id, status: { $ne: REGISTRATION_STATUS.CANCELLED } })
      .sort({ createdAt: 1 })
      .lean(),
    AmenityWaitlist.find({ eventId: id, status: "WAITING" }).sort({ position: 1 }).lean(),
  ]);

  return ok({ event, registrations, waitlist });
});

// PATCH — edit an event. Time or venue changes notify everyone registered,
// because a changed start time that nobody hears about is a failed event.
export const PATCH = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.MANAGE_EVENTS);
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid event id");

  const parsed = eventUpdateSchema.safeParse(await request.json());
  if (!parsed.success) return zodFail(parsed);

  const prev = await AmenityEvent.findOne({ _id: id, societyId: g.societyId }).lean();
  if (!prev) return fail(404, "Event not found");
  if (prev.status === EVENT_STATUS.CANCELLED) return fail(409, "This event is cancelled");
  if (prev.status === EVENT_STATUS.COMPLETED) return fail(409, "This event is already complete");

  const startAt = parsed.data.startAt ? new Date(parsed.data.startAt) : prev.startAt;
  const endAt = parsed.data.endAt ? new Date(parsed.data.endAt) : prev.endAt;
  if (endAt <= startAt) return fail(422, "The event must end after it starts");

  if (parsed.data.startAt || parsed.data.endAt) {
    const clash = await AmenityEvent.findOne({
      _id: { $ne: id },
      amenityId: prev.amenityId,
      status: { $in: [EVENT_STATUS.DRAFT, EVENT_STATUS.PUBLISHED] },
      startAt: { $lt: endAt },
      endAt: { $gt: startAt },
    })
      .select("title")
      .lean();
    if (clash) return fail(409, `"${clash.title}" is already booked at that time`);
  }

  // Capacity cannot drop below people already confirmed — that would require
  // un-registering residents who did nothing wrong.
  if (parsed.data.capacity != null && parsed.data.capacity < (prev.registeredCount || 0)) {
    return fail(
      422,
      `${prev.registeredCount} residents have already registered. Capacity cannot be lower than that.`,
    );
  }

  const next = await AmenityEvent.findOneAndUpdate(
    { _id: id, societyId: g.societyId },
    { $set: { ...parsed.data, startAt, endAt, updatedBy: g.actor.userId } },
    { new: true },
  ).lean();

  await logUpdate({
    societyId: g.societyId,
    entityType: "EVENT",
    entityId: next._id,
    amenityId: next.amenityId,
    amenityName: next.amenityName,
    action: ACTIVITY_ACTION.EVENT_UPDATED,
    actor: g.actor,
    prev,
    next: { ...parsed.data, startAt, endAt },
  });

  const amenity = await Amenity.findById(next.amenityId).lean();

  // Publishing a draft is an announcement to the society; other edits only
  // concern the people already registered.
  if (prev.status === EVENT_STATUS.DRAFT && next.status === EVENT_STATUS.PUBLISHED) {
    if (amenity) await notifyEventCreated({ societyId: g.societyId, amenity, event: next, actor: g.actor });
  } else {
    const materialChange =
      String(prev.startAt) !== String(next.startAt) ||
      String(prev.endAt) !== String(next.endAt) ||
      prev.venue !== next.venue;
    if (materialChange && parsed.data.notify !== false) {
      await notifyEventUpdated({ societyId: g.societyId, event: next, previous: prev, actor: g.actor });
    }
  }

  // A capacity increase should pull people off the waitlist immediately.
  if (parsed.data.capacity != null && parsed.data.capacity > (prev.capacity || 0)) {
    const settings = await getSettings(g.societyId);
    await promoteFromWaitlist({ societyId: g.societyId, eventId: id, settings }).catch(() => {});
  }

  return ok({ event: next });
});

// DELETE — cancel, never destroy. Registrations and attendance must survive for
// the historical record, and registrants have to be told.
export const DELETE = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.MANAGE_EVENTS);
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid event id");

  const reason = new URL(request.url).searchParams.get("reason") || "";

  const event = await AmenityEvent.findOne({ _id: id, societyId: g.societyId });
  if (!event) return fail(404, "Event not found");
  if (event.status === EVENT_STATUS.CANCELLED) return ok({ event: event.toObject(), alreadyCancelled: true });

  const result = await cancelEvent({ event, reason, actorUserId: g.actor.userId });

  await logAmenityActivity({
    societyId: g.societyId,
    entityType: "EVENT",
    entityId: event._id,
    amenityId: event.amenityId,
    amenityName: event.amenityName,
    action: ACTIVITY_ACTION.EVENT_CANCELLED,
    actor: g.actor,
    oldValue: { status: EVENT_STATUS.PUBLISHED, registeredCount: event.registeredCount },
    newValue: { status: EVENT_STATUS.CANCELLED, reason },
    note: reason,
  });

  return ok(result);
});

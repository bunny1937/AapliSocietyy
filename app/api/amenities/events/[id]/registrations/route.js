import AmenityEvent from "@/models/amenities/AmenityEvent";
import AmenityEventRegistration from "@/models/amenities/AmenityEventRegistration";
import AmenityAttendance from "@/models/amenities/AmenityAttendance";
import { Member as V1Member } from "@/lib/v1/models";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION, REGISTRATION_STATUS } from "@/lib/amenities/constants";
import { eventRegisterSchema } from "@/lib/amenities/schemas";
import { registerForEvent, RegistrationError } from "@/lib/amenities/eventService";
import { gate, ok, created, fail, zodFail, isId, withAmenityRoute, CAPABILITY } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Maps service error codes onto HTTP status codes. Mirrors the mapping in
// app/api/v1/amenities/events/[id]/register/route.js, which is the same
// service call from the resident's own side.
const REGISTRATION_ERROR_STATUS = {
  EVENT_CANCELLED: 409,
  EVENT_NOT_OPEN: 409,
  EVENT_STARTED: 409,
  REGISTRATION_CLOSED: 409,
  ALREADY_REGISTERED: 409,
  EVENT_FULL: 409,
  NO_REGISTRATION: 400,
  GUESTS_NOT_ALLOWED: 400,
  GUEST_LIMIT: 400,
  NOT_REGISTERED: 404,
};

// POST — desk/walk-in registration: an admin or guard registering a resident
// who could not or did not use the app themselves (phone sign-up, kiosk).
export const POST = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.MANAGE_REGISTRATIONS);
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid event id");

  const parsed = eventRegisterSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return zodFail(parsed);
  if (!parsed.data.memberId) return fail(422, "memberId is required for a desk registration");

  const event = await AmenityEvent.findOne({ _id: id, societyId: g.societyId }).lean();
  if (!event) return fail(404, "Event not found");

  const member = await V1Member.findOne({ _id: parsed.data.memberId, societyId: g.societyId })
    .select("_id name flatNo wing occupancyType")
    .lean();
  if (!member) return fail(404, "Resident not found");

  try {
    const { registration, seatsLeft } = await registerForEvent({
      societyId: g.societyId,
      event,
      member: {
        memberId: member._id,
        userId: null,
        name: member.name,
        flatNo: [member.wing, member.flatNo].filter(Boolean).join("-") || member.flatNo || "",
        occupancyType: member.occupancyType,
      },
      guestCount: parsed.data.guestCount || 0,
      note: parsed.data.note,
    });

    await logAmenityActivity({
      societyId: g.societyId,
      entityType: "REGISTRATION",
      entityId: registration._id,
      amenityId: event.amenityId,
      amenityName: event.amenityName,
      action: ACTIVITY_ACTION.EVENT_REGISTERED,
      actor: g.actor,
      newValue: { memberName: registration.memberName, guestCount: registration.guestCount },
      note: "Desk registration",
    });

    return created({ registration, seatsLeft });
  } catch (err) {
    if (err instanceof RegistrationError) {
      return fail(REGISTRATION_ERROR_STATUS[err.code] || 400, err.message, err.meta);
    }
    throw err;
  }
});

// GET — the attendee sheet, with a live "has arrived" flag derived from
// attendance rather than stored twice.
export const GET = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.MANAGE_REGISTRATIONS);
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid event id");

  const event = await AmenityEvent.findOne({ _id: id, societyId: g.societyId }).lean();
  if (!event) return fail(404, "Event not found");

  const [registrations, attended] = await Promise.all([
    AmenityEventRegistration.find({ eventId: id }).sort({ createdAt: 1 }).lean(),
    AmenityAttendance.find({ eventId: id }).select("memberId timeIn timeOut").lean(),
  ]);

  const arrivedBy = new Map(attended.map((a) => [String(a.memberId), a]));
  const rows = registrations.map((r) => ({
    ...r,
    arrived: arrivedBy.has(String(r.memberId)),
    timeIn: arrivedBy.get(String(r.memberId))?.timeIn || null,
  }));

  return ok({
    event,
    registrations: rows,
    totals: {
      confirmed: rows.filter((r) => r.status === REGISTRATION_STATUS.CONFIRMED).length,
      cancelled: rows.filter((r) => r.status === REGISTRATION_STATUS.CANCELLED).length,
      arrived: rows.filter((r) => r.arrived).length,
      guests: rows.reduce((sum, r) => sum + (r.guestCount || 0), 0),
    },
  });
});

// PATCH — mark attended / no-show after the event, so "event attendance" in the
// analytics reflects who actually turned up.
export const PATCH = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.MANAGE_REGISTRATIONS);
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid event id");

  const body = await request.json().catch(() => ({}));
  if (!isId(body.registrationId)) return fail(400, "registrationId is required");
  if (![REGISTRATION_STATUS.ATTENDED, REGISTRATION_STATUS.NO_SHOW].includes(body.status)) {
    return fail(422, "status must be ATTENDED or NO_SHOW");
  }

  const registration = await AmenityEventRegistration.findOneAndUpdate(
    { _id: body.registrationId, eventId: id, societyId: g.societyId },
    { $set: { status: body.status, markedBy: g.actor.userId, markedAt: new Date() } },
    { new: true },
  ).lean();
  if (!registration) return fail(404, "Registration not found");

  if (body.status === REGISTRATION_STATUS.ATTENDED) {
    await AmenityEvent.updateOne({ _id: id }, { $inc: { attendedCount: 1 } });
  }

  await logAmenityActivity({
    societyId: g.societyId,
    entityType: "REGISTRATION",
    entityId: registration._id,
    amenityId: registration.amenityId,
    action: ACTIVITY_ACTION.REGISTRATION_UPDATED,
    actor: g.actor,
    newValue: { status: registration.status, memberName: registration.memberName },
  });

  return ok({ registration });
});

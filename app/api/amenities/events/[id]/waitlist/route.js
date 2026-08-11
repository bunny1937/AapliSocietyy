import AmenityEvent from "@/models/amenities/AmenityEvent";
import { getEventWaitlist, promoteFromWaitlist } from "@/lib/amenities/waitlistService";
import { getSettings } from "@/lib/amenities/settingsService";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION } from "@/lib/amenities/constants";
import { gate, ok, fail, isId, withAmenityRoute, CAPABILITY } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.MANAGE_REGISTRATIONS);
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid event id");

  const waitlist = await getEventWaitlist(id);
  return ok({ waitlist });
});

// POST — promote from the queue.
//
// Promotion normally happens automatically when someone cancels; this endpoint
// is the manual lever for the case where an admin has just freed capacity by
// other means, or wants to fill remaining seats before the doors open.
export const POST = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.MANAGE_REGISTRATIONS);
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid event id");

  const body = await request.json().catch(() => ({}));

  const event = await AmenityEvent.findOne({ _id: id, societyId: g.societyId }).lean();
  if (!event) return fail(404, "Event not found");

  const settings = await getSettings(g.societyId);
  const result = await promoteFromWaitlist({
    societyId: g.societyId,
    eventId: id,
    settings,
    limit: Number(body.limit) || undefined,
  });

  if (result.promoted?.length) {
    await logAmenityActivity({
      societyId: g.societyId,
      entityType: "WAITLIST",
      entityId: event._id,
      amenityId: event.amenityId,
      amenityName: event.amenityName,
      action: ACTIVITY_ACTION.WAITLIST_PROMOTED,
      actor: g.actor,
      newValue: { promoted: result.promoted.length },
      note: `Promoted ${result.promoted.length} resident(s) from the waitlist`,
    });
  }

  return ok(result);
});

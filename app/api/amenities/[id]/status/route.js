import Amenity from "@/models/amenities/Amenity";
import AmenityAttendance from "@/models/amenities/AmenityAttendance";
import { statusChangeSchema } from "@/lib/amenities/schemas";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION, AMENITY_STATUS, NON_USABLE_STATUSES } from "@/lib/amenities/constants";
import { notifyStatusChanged } from "@/lib/amenities/notify";
import { getSettings } from "@/lib/amenities/settingsService";
import { CAPABILITY, gate, ok, fail, zodFail, isId, withAmenityRoute } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/amenities/[id]/status
//
// The single, auditable entry point for opening and closing an amenity. Split
// from the generic PATCH because it notifies the whole society — that is a
// deliberate act, never a side effect.
export const POST = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.CHANGE_STATUS);
  if (!g.ok) return g.response;

  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid amenity id");

  const parsed = statusChangeSchema.safeParse(await request.json());
  if (!parsed.success) return zodFail(parsed);
  const { status, note, notify = true, isEmergency = false } = parsed.data;

  const amenity = await Amenity.findOne({ _id: id, societyId: g.societyId, isDeleted: false }).lean();
  if (!amenity) return fail(404, "Amenity not found");

  if (amenity.status === status) {
    return ok({ amenity, unchanged: true, message: `${amenity.name} is already marked ${status}.` });
  }

  // Maintenance owns the status while a window is running. Letting an admin flip
  // an amenity back to Open here would contradict the maintenance record still
  // showing in progress — they must reopen it from Maintenance instead.
  if (amenity.activeMaintenanceId && status === AMENITY_STATUS.OPEN) {
    return fail(409,
      "This amenity is under maintenance. Reopen it from the maintenance record so the maintenance history stays correct.",
      { maintenanceId: amenity.activeMaintenanceId });
  }
  if (status === AMENITY_STATUS.UNDER_MAINTENANCE && !amenity.activeMaintenanceId) {
    return fail(422,
      "Schedule a maintenance window instead — that sets the status and tells residents when the amenity will be back.");
  }

  const closing = NON_USABLE_STATUSES.includes(status);
  const openNow = closing
    ? await AmenityAttendance.countDocuments({ amenityId: id, timeOut: null })
    : 0;

  const updated = await Amenity.findByIdAndUpdate(
    id,
    {
      $set: {
        status,
        statusNote: note || "",
        statusChangedAt: new Date(),
        statusChangedBy: g.actor.userId,
        updatedBy: g.actor.userId,
        ...(status === AMENITY_STATUS.PERMANENTLY_CLOSED ? { isActive: false } : {}),
      },
    },
    { new: true },
  ).lean();

  // People already inside are NOT force-checked-out: their session is real and
  // the duration data matters. The caller is told instead.
  const settings = await getSettings(g.societyId);
  if (notify && (settings.notifyOnStatusChange !== false || isEmergency)) {
    await notifyStatusChanged({
      societyId: g.societyId,
      amenity: updated,
      status,
      note,
      isEmergency,
      actor: g.actor,
    });
  }

  await logAmenityActivity({
    societyId: g.societyId,
    entityType: "AMENITY",
    entityId: id,
    amenityId: id,
    amenityName: updated.name,
    action: ACTIVITY_ACTION.AMENITY_STATUS_CHANGED,
    actor: g.actor,
    oldValue: { status: amenity.status },
    newValue: { status, note: note || "", isEmergency },
    changedFields: ["status"],
  });

  return ok({
    amenity: updated,
    notified: notify,
    ...(openNow ? {
      warning: `${openNow} ${openNow === 1 ? "person is" : "people are"} still checked in. They can check out normally.`,
      openCheckIns: openNow,
    } : {}),
  });
});

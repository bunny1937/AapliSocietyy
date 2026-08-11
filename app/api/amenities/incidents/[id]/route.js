import AmenityIncident from "@/models/amenities/AmenityIncident";
import { incidentUpdateSchema } from "@/lib/amenities/schemas";
import { logUpdate } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION, INCIDENT_STATUS, SEVERITY_RANK } from "@/lib/amenities/constants";
import { notifyIncidentResolved } from "@/lib/amenities/notify";
import { gate, ok, fail, zodFail, isId, withAmenityRoute, CAPABILITY } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.VIEW_INCIDENTS);
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid incident id");

  const incident = await AmenityIncident.findOne({ _id: id, societyId: g.societyId }).lean();
  if (!incident) return fail(404, "Incident not found");
  return ok({ incident });
});

// PATCH — triage, assign, resolve, close.
export const PATCH = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.MANAGE_INCIDENTS);
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid incident id");

  const parsed = incidentUpdateSchema.safeParse(await request.json());
  if (!parsed.success) return zodFail(parsed);

  const prev = await AmenityIncident.findOne({ _id: id, societyId: g.societyId }).lean();
  if (!prev) return fail(404, "Incident not found");
  if (prev.status === INCIDENT_STATUS.CLOSED && parsed.data.status !== INCIDENT_STATUS.OPEN) {
    return fail(409, "This incident is closed. Reopen it before making further changes.");
  }

  const update = { ...parsed.data, updatedBy: g.actor.userId };
  // findOneAndUpdate skips document middleware, so the pre-validate hook that
  // keeps severityRank in sync with severity never fires here - set it by hand.
  if (parsed.data.severity) update.severityRank = SEVERITY_RANK[parsed.data.severity] || 1;

  // Resolution notes are required to resolve: "fixed" with no explanation is
  // useless to the next person who reads the record.
  if (parsed.data.status === INCIDENT_STATUS.RESOLVED) {
    const notes = parsed.data.resolutionNotes || prev.resolutionNotes;
    if (!notes) return fail(422, "Add resolution notes before marking this incident resolved");
    update.resolutionDate = prev.resolutionDate || new Date();
    update.resolvedBy = g.actor.userId;
    update.resolvedByName = g.actor.name;
  }

  // Reopening clears the resolution so the record cannot show "open" and a
  // resolution date at the same time.
  if (parsed.data.status === INCIDENT_STATUS.OPEN && prev.status !== INCIDENT_STATUS.OPEN) {
    update.resolutionDate = null;
    update.resolvedBy = null;
    update.resolvedByName = "";
  }

  if (parsed.data.assignedTo && parsed.data.assignedTo !== String(prev.assignedTo || "")) {
    update.assignedAt = new Date();
    update.assignedBy = g.actor.userId;
    if (!parsed.data.status && prev.status === INCIDENT_STATUS.OPEN) {
      update.status = INCIDENT_STATUS.IN_PROGRESS;
    }
  }

  const next = await AmenityIncident.findOneAndUpdate(
    { _id: id, societyId: g.societyId },
    { $set: update },
    { new: true },
  ).lean();

  await logUpdate({
    societyId: g.societyId,
    entityType: "INCIDENT",
    entityId: next._id,
    amenityId: next.amenityId,
    amenityName: next.amenityName,
    action:
      parsed.data.status === INCIDENT_STATUS.RESOLVED
        ? ACTIVITY_ACTION.INCIDENT_RESOLVED
        : ACTIVITY_ACTION.INCIDENT_UPDATED,
    actor: g.actor,
    prev,
    next: update,
  });

  // Close the loop with whoever reported it.
  if (parsed.data.status === INCIDENT_STATUS.RESOLVED && prev.status !== INCIDENT_STATUS.RESOLVED) {
    await notifyIncidentResolved({ societyId: g.societyId, incident: next, actor: g.actor });
  }

  return ok({ incident: next });
});

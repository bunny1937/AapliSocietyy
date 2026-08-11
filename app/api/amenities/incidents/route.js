import Amenity from "@/models/amenities/Amenity";
import AmenityIncident from "@/models/amenities/AmenityIncident";
import { incidentCreateSchema } from "@/lib/amenities/schemas";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION, INCIDENT_STATUS } from "@/lib/amenities/constants";
import { notifyIncidentReported } from "@/lib/amenities/notify";
import { getSettings } from "@/lib/amenities/settingsService";
import {
  gate, ok, created, fail, zodFail, isId, paging, pageMeta, dateRange,
  withAmenityRoute, CAPABILITY,
} from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/amenities/incidents?amenityId=&status=&severity=&type=&open=1
export const GET = withAmenityRoute(async (request) => {
  const g = await gate(request, CAPABILITY.VIEW_INCIDENTS);
  if (!g.ok) return g.response;

  const sp = new URL(request.url).searchParams;
  const { page, limit, skip } = paging(sp);

  const filter = { societyId: g.societyId };
  if (isId(sp.get("amenityId"))) filter.amenityId = sp.get("amenityId");
  if (sp.get("status")) filter.status = sp.get("status");
  if (sp.get("severity")) filter.severity = sp.get("severity");
  if (sp.get("type")) filter.incidentType = sp.get("type");

  // The default queue view is "still needs someone", which is what the incident
  // screen opens on; a date window only applies when browsing history.
  if (sp.get("open") === "1") {
    filter.status = { $in: [INCIDENT_STATUS.OPEN, INCIDENT_STATUS.IN_PROGRESS] };
  } else if (sp.get("from") || sp.get("to")) {
    const range = dateRange(sp, { defaultDays: 90 });
    if (!range) return fail(422, "Invalid date range");
    filter.createdAt = { $gte: range.from, $lte: range.to };
  }

  const [incidents, total, bySeverity] = await Promise.all([
    AmenityIncident.find(filter)
      // Critical first, then oldest — a severe incident should never be buried
      // under newer trivia.
      .sort({ severityRank: -1, createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AmenityIncident.countDocuments(filter),
    AmenityIncident.aggregate([
      { $match: { societyId: g.societyId, status: { $in: [INCIDENT_STATUS.OPEN, INCIDENT_STATUS.IN_PROGRESS] } } },
      { $group: { _id: "$severity", count: { $sum: 1 } } },
    ]),
  ]);

  return ok({ incidents, openBySeverity: bySeverity, pagination: pageMeta({ page, limit, total }) });
});

// POST — report an incident. Residents and security both use this (they hold
// REPORT_INCIDENT), while assignment and resolution need MANAGE_INCIDENTS.
export const POST = withAmenityRoute(async (request) => {
  const g = await gate(request, CAPABILITY.REPORT_INCIDENT);
  if (!g.ok) return g.response;

  const parsed = incidentCreateSchema.safeParse(await request.json());
  if (!parsed.success) return zodFail(parsed);

  const amenity = await Amenity.findOne({
    _id: parsed.data.amenityId,
    societyId: g.societyId,
    isDeleted: false,
  }).lean();
  if (!amenity) return fail(404, "Amenity not found");

  // Incident types are society-configurable, so validate against this society's
  // list rather than a hardcoded enum.
  const settings = await getSettings(g.societyId);
  const allowedTypes = settings?.incidentTypes || [];
  if (allowedTypes.length && !allowedTypes.includes(parsed.data.incidentType)) {
    return fail(422, `"${parsed.data.incidentType}" is not one of this society's incident types`, {
      allowedTypes,
    });
  }

  const incident = await AmenityIncident.create({
    ...parsed.data,
    societyId: g.societyId,
    amenityName: amenity.name,
    status: INCIDENT_STATUS.OPEN,
    reportedBy: g.actor.userId,
    reportedByName: g.actor.name,
    reportedByRole: g.actor.role,
  });

  await logAmenityActivity({
    societyId: g.societyId,
    entityType: "INCIDENT",
    entityId: incident._id,
    amenityId: amenity._id,
    amenityName: amenity.name,
    action: ACTIVITY_ACTION.INCIDENT_REPORTED,
    actor: g.actor,
    newValue: { title: incident.title, severity: incident.severity, incidentType: incident.incidentType },
  });

  await notifyIncidentReported({ societyId: g.societyId, amenity, incident: incident.toObject(), actor: g.actor });

  return created({ incident });
});

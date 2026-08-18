import { withRoute, json } from "@/lib/v1/http";
import connectDB from "@/lib/mongodb";
import { z } from "zod";
import Amenity from "@/models/amenities/Amenity";
import AmenityIncident from "@/models/amenities/AmenityIncident";
import { clubhouseContext } from "@/lib/amenities/clubhouseContext";
import { CAPABILITY } from "@/lib/amenities/permissions";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { notifyIncidentReported } from "@/lib/amenities/notify";
import {
  ACTIVITY_ACTION,
  INCIDENT_SEVERITY,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUS,
} from "@/lib/amenities/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  amenityId: z.string().regex(/^[a-f\d]{24}$/i),
  incidentType: z.string().trim().min(2).max(60),
  title: z.string().trim().min(4).max(120),
  description: z.string().trim().min(10).max(4000),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
});

const updateSchema = z.object({
  incidentId: z.string().regex(/^[a-f\d]{24}$/i),
  status: z.enum([INCIDENT_STATUS.OPEN, INCIDENT_STATUS.IN_PROGRESS, INCIDENT_STATUS.RESOLVED]),
  resolutionNotes: z.string().trim().max(4000).optional(),
});

// GET / POST / PATCH /api/v1/clubhouse/incidents
//
// Raise, progress and resolve incidents from the desk, through the existing
// AmenityIncident collection and the existing notify fan-out to Admin. Nothing
// new is modelled: the manager is simply another reporter and another resolver.
//
// incidentType stays a free string validated for length, exactly as the website
// route treats it — the list of types is per-society settings, not a schema enum.
export const GET = withRoute(async (request) => {
  const ctx = await clubhouseContext(request, CAPABILITY.VIEW_INCIDENTS);
  await connectDB();

  const sp = new URL(request.url).searchParams;
  const status = sp.get("status");
  const filter = { societyId: ctx.societyId };
  if (status === "open") {
    filter.status = { $in: [INCIDENT_STATUS.OPEN, INCIDENT_STATUS.IN_PROGRESS] };
  } else if (status) {
    filter.status = status;
  }

  const rows = await AmenityIncident.find(filter)
    // Severity first, then recency: the triage order the severityRank index on
    // the model exists for.
    .sort({ severityRank: -1, createdAt: -1 })
    .limit(60)
    .select("amenityId incidentNo incidentType title description severity status createdAt reportedByName resolvedAt resolutionNotes")
    .lean();

  const names = new Map(
    (
      await Amenity.find({ _id: { $in: rows.map((r) => r.amenityId) } })
        .select("name")
        .lean()
    ).map((a) => [String(a._id), a.name]),
  );

  return json({
    incidents: rows.map((r) => ({
      _id: r._id,
      incidentNo: r.incidentNo || "",
      amenityId: r.amenityId,
      amenityName: names.get(String(r.amenityId)) || "",
      incidentType: r.incidentType,
      title: r.title,
      description: r.description,
      severity: r.severity,
      status: r.status,
      createdAt: r.createdAt,
      reportedByName: r.reportedByName || "",
      resolvedAt: r.resolvedAt || null,
      resolutionNotes: r.resolutionNotes || "",
    })),
  });
});

export const POST = withRoute(async (request) => {
  const ctx = await clubhouseContext(request, CAPABILITY.REPORT_INCIDENT);
  await connectDB();

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return json({ error: parsed.error.flatten() }, { status: 400 });
  const data = parsed.data;

  const amenity = await Amenity.findOne({ _id: data.amenityId, societyId: ctx.societyId, isDeleted: false })
    .select("name")
    .lean();
  if (!amenity) return json({ error: "Amenity not found" }, { status: 404 });

  const incident = await AmenityIncident.create({
    societyId: ctx.societyId,
    amenityId: amenity._id,
    incidentType: data.incidentType,
    title: data.title,
    description: data.description,
    severity: data.severity || INCIDENT_SEVERITY.LOW,
    status: INCIDENT_STATUS.OPEN,
    reportedBy: ctx.userId,
    reportedByName: ctx.name,
    reportedByRole: "Clubhouse Manager",
    occurredAt: new Date(),
  });

  // Admin is told, because an incident raised at the desk is exactly the thing
  // the office needs to know about without being asked.
  await notifyIncidentReported({ societyId: ctx.societyId, incident: { ...incident.toObject(), amenityName: amenity.name }, actor: ctx.actor });

  await logAmenityActivity({
    societyId: ctx.societyId,
    entityType: "INCIDENT",
    entityId: incident._id,
    amenityId: amenity._id,
    amenityName: amenity.name,
    action: ACTIVITY_ACTION.INCIDENT_REPORTED,
    actor: ctx.actor,
    newValue: { title: incident.title, severity: incident.severity, via: "CLUBHOUSE" },
    note: incident.title,
  });

  return json({ ok: true, incident }, { status: 201 });
});

export const PATCH = withRoute(async (request) => {
  const ctx = await clubhouseContext(request, CAPABILITY.MANAGE_INCIDENTS);
  await connectDB();

  const parsed = updateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return json({ error: parsed.error.flatten() }, { status: 400 });
  const { incidentId, status, resolutionNotes } = parsed.data;

  const current = await AmenityIncident.findOne({ _id: incidentId, societyId: ctx.societyId }).lean();
  if (!current) return json({ error: "Incident not found" }, { status: 404 });

  const resolving = status === INCIDENT_STATUS.RESOLVED;
  if (resolving && !resolutionNotes) {
    // A resolution with no account of what was done is not a resolution.
    return json({ error: "Add a short note about what was done." }, { status: 422 });
  }

  const updated = await AmenityIncident.findByIdAndUpdate(
    incidentId,
    {
      $set: {
        status,
        ...(resolutionNotes ? { resolutionNotes } : {}),
        ...(resolving ? { resolvedAt: new Date(), resolvedBy: ctx.userId } : {}),
      },
    },
    { new: true },
  ).lean();

  await logAmenityActivity({
    societyId: ctx.societyId,
    entityType: "INCIDENT",
    entityId: incidentId,
    amenityId: current.amenityId,
    action: resolving ? ACTIVITY_ACTION.INCIDENT_RESOLVED : ACTIVITY_ACTION.INCIDENT_UPDATED,
    actor: ctx.actor,
    oldValue: { status: current.status },
    newValue: { status, via: "CLUBHOUSE" },
    changedFields: ["status"],
    note: resolutionNotes || "",
  });

  return json({ ok: true, incident: updated });
});

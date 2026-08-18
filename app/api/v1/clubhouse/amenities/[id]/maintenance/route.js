import { withRoute, json } from "@/lib/v1/http";
import connectDB from "@/lib/mongodb";
import { z } from "zod";
import Amenity from "@/models/amenities/Amenity";
import AmenityMaintenance from "@/models/amenities/AmenityMaintenance";
import { clubhouseContext } from "@/lib/amenities/clubhouseContext";
import { CAPABILITY } from "@/lib/amenities/permissions";
import { findOverlappingMaintenance } from "@/lib/amenities/availability";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { notifyMaintenanceScheduled, notifyAmenityReopened } from "@/lib/amenities/notify";
import {
  ACTIVITY_ACTION,
  AMENITY_STATUS,
  MAINTENANCE_STATUS,
} from "@/lib/amenities/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("open"),
    reason: z.string().trim().min(3).max(300),
    notes: z.string().trim().max(2000).optional(),
    endDate: z.string().datetime().optional(),
    isEmergency: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("close"),
    maintenanceId: z.string().regex(/^[a-f\d]{24}$/i),
    notes: z.string().trim().max(2000).optional(),
  }),
]);

// GET / POST /api/v1/clubhouse/amenities/[id]/maintenance
//
// The manager logs what is broken and reopens it when it is fixed — the two ends
// of a maintenance window, from the phone, while standing in front of it.
//
// Written through the existing AmenityMaintenance record rather than by flipping
// the amenity's status directly, which is what keeps the two consistent: the
// status route refuses to reopen an amenity that has a live maintenance record,
// and this is the thing that closes it. previousAmenityStatus is captured at open
// time so reopening restores what was there instead of assuming OPEN.
//
// Extending a window and reopening early with full history stay on the website;
// this is the shift-level subset.
export const GET = withRoute(async (request, { params }) => {
  const ctx = await clubhouseContext(request, CAPABILITY.VIEW_AMENITIES);
  await connectDB();
  const { id } = await params;

  const rows = await AmenityMaintenance.find({ amenityId: id, societyId: ctx.societyId })
    .sort({ startDate: -1 })
    .limit(20)
    .lean();

  return json({
    maintenance: rows.map((m) => ({
      _id: m._id,
      reason: m.reason,
      notes: m.notes || "",
      status: m.status,
      startDate: m.startDate,
      endDate: m.endDate,
      isEmergency: !!m.isEmergency,
      reopenedAt: m.reopenedAt || null,
      createdByName: m.createdByName || "",
    })),
  });
});

export const POST = withRoute(async (request, { params }) => {
  const ctx = await clubhouseContext(request, CAPABILITY.MANAGE_MAINTENANCE);
  await connectDB();

  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return json({ error: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;

  const amenity = await Amenity.findOne({ _id: id, societyId: ctx.societyId, isDeleted: false }).lean();
  if (!amenity) return json({ error: "Amenity not found" }, { status: 404 });

  if (body.action === "open") {
    if (amenity.activeMaintenanceId) {
      return json(
        { error: `${amenity.name} is already under maintenance.`, code: "ALREADY_UNDER_MAINTENANCE", maintenanceId: amenity.activeMaintenanceId },
        { status: 409 },
      );
    }

    const startDate = new Date();
    // Default window: the rest of today. An operational log entry should not
    // quietly close an amenity indefinitely — a long window is an Admin
    // decision, made on the website with the calendar in front of them.
    const endDate = body.endDate
      ? new Date(body.endDate)
      : new Date(startDate.getTime() + 12 * 60 * 60 * 1000);
    if (endDate <= startDate) return json({ error: "The window must end after it starts." }, { status: 422 });

    const overlapping = await findOverlappingMaintenance({ amenityId: id, startDate, endDate });
    if (overlapping) {
      return json(
        { error: "Another maintenance window already covers this time.", code: "OVERLAP", maintenanceId: overlapping._id },
        { status: 409 },
      );
    }

    const doc = await AmenityMaintenance.create({
      societyId: ctx.societyId,
      amenityId: id,
      startDate,
      endDate,
      reason: body.reason,
      notes: body.notes || "",
      status: MAINTENANCE_STATUS.IN_PROGRESS,
      previousAmenityStatus: amenity.status,
      isEmergency: !!body.isEmergency,
      createdBy: ctx.userId,
      createdByName: ctx.name,
    });

    const updated = await Amenity.findByIdAndUpdate(
      id,
      {
        $set: {
          status: AMENITY_STATUS.UNDER_MAINTENANCE,
          statusNote: body.reason,
          statusChangedAt: startDate,
          statusChangedBy: ctx.userId,
          activeMaintenanceId: doc._id,
          updatedBy: ctx.userId,
        },
      },
      { new: true },
    ).lean();

    await notifyMaintenanceScheduled({ societyId: ctx.societyId, amenity: updated, maintenance: doc, actor: ctx.actor });

    await logAmenityActivity({
      societyId: ctx.societyId,
      entityType: "MAINTENANCE",
      entityId: doc._id,
      amenityId: id,
      amenityName: amenity.name,
      action: ACTIVITY_ACTION.MAINTENANCE_SCHEDULED,
      actor: ctx.actor,
      oldValue: { status: amenity.status },
      newValue: { status: AMENITY_STATUS.UNDER_MAINTENANCE, reason: body.reason, endDate, via: "CLUBHOUSE" },
      changedFields: ["status", "activeMaintenanceId"],
      note: body.reason,
    });

    return json({ ok: true, maintenance: doc, amenity: updated });
  }

  // close — the amenity is back in service.
  const record = await AmenityMaintenance.findOne({
    _id: body.maintenanceId,
    amenityId: id,
    societyId: ctx.societyId,
  }).lean();
  if (!record) return json({ error: "Maintenance record not found" }, { status: 404 });
  if (record.status === MAINTENANCE_STATUS.COMPLETED) {
    return json({ ok: true, maintenance: record, unchanged: true });
  }

  const now = new Date();
  const early = now < new Date(record.endDate);

  const closed = await AmenityMaintenance.findByIdAndUpdate(
    record._id,
    {
      $set: {
        status: MAINTENANCE_STATUS.COMPLETED,
        reopenedAt: now,
        reopenedBy: ctx.userId,
        reopenedEarly: early,
        ...(body.notes ? { notes: body.notes } : {}),
        updatedBy: ctx.userId,
        updatedByName: ctx.name,
      },
    },
    { new: true },
  ).lean();

  // Restore what the amenity was before, not OPEN: a permanently closed amenity
  // must not be promoted back into service by a maintenance reopen.
  const restoreTo =
    record.previousAmenityStatus && record.previousAmenityStatus !== AMENITY_STATUS.UNDER_MAINTENANCE
      ? record.previousAmenityStatus
      : AMENITY_STATUS.OPEN;

  const updated = await Amenity.findByIdAndUpdate(
    id,
    {
      $set: {
        status: restoreTo,
        statusNote: "",
        statusChangedAt: now,
        statusChangedBy: ctx.userId,
        activeMaintenanceId: null,
        updatedBy: ctx.userId,
      },
    },
    { new: true },
  ).lean();

  await notifyAmenityReopened({ societyId: ctx.societyId, amenity: updated, early, actor: ctx.actor });

  await logAmenityActivity({
    societyId: ctx.societyId,
    entityType: "MAINTENANCE",
    entityId: record._id,
    amenityId: id,
    amenityName: amenity.name,
    action: ACTIVITY_ACTION.MAINTENANCE_COMPLETED,
    actor: ctx.actor,
    oldValue: { status: record.status, amenityStatus: AMENITY_STATUS.UNDER_MAINTENANCE },
    newValue: { status: MAINTENANCE_STATUS.COMPLETED, amenityStatus: restoreTo, reopenedEarly: early, via: "CLUBHOUSE" },
    changedFields: ["status"],
    note: body.notes || "Reopened from the clubhouse desk",
  });

  return json({ ok: true, maintenance: closed, amenity: updated });
});

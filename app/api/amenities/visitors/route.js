import Amenity from "@/models/amenities/Amenity";
import AmenityVisitor from "@/models/amenities/AmenityVisitor";
import { amenityVisitorCreateSchema } from "@/lib/amenities/schemas";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION } from "@/lib/amenities/constants";
import { toMinutes, minutesOfDay } from "@/lib/amenities/time";
import { getTimezone } from "@/lib/amenities/settingsService";
import {
  gate, ok, created, fail, zodFail, isId, paging, pageMeta, dateRange,
  withAmenityRoute, CAPABILITY,
} from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/amenities/visitors — guard/admin register of amenity visitors.
export const GET = withAmenityRoute(async (request) => {
  const g = await gate(request, CAPABILITY.VERIFY_VISITORS);
  if (!g.ok) return g.response;

  const sp = new URL(request.url).searchParams;
  const { page, limit, skip } = paging(sp);
  const range = dateRange(sp, { defaultDays: 7 });
  if (!range) return fail(422, "Invalid date range");

  const filter = { societyId: g.societyId, createdAt: { $gte: range.from, $lte: range.to } };
  if (isId(sp.get("amenityId"))) filter.amenityId = sp.get("amenityId");
  if (sp.get("status")) filter.status = sp.get("status");

  const [visitors, total] = await Promise.all([
    AmenityVisitor.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AmenityVisitor.countDocuments(filter),
  ]);

  return ok({ visitors, pagination: pageMeta({ page, limit, total }) });
});

// POST — register a visitor against an amenity. Enforces the amenity's own
// visitor policy so the rules the admin configured are the rules applied,
// rather than being re-typed into the guard app.
export const POST = withAmenityRoute(async (request) => {
  const g = await gate(request, CAPABILITY.VERIFY_VISITORS);
  if (!g.ok) return g.response;

  const parsed = amenityVisitorCreateSchema.safeParse(await request.json());
  if (!parsed.success) return zodFail(parsed);

  const amenity = await Amenity.findOne({
    _id: parsed.data.amenityId,
    societyId: g.societyId,
    isDeleted: false,
  }).lean();
  if (!amenity) return fail(404, "Amenity not found");

  const policy = amenity.visitorPolicy || {};
  if (!policy.allowed) return fail(409, `Visitors are not allowed at ${amenity.name}`);

  if (policy.allowedVisitorTypes?.length && parsed.data.visitorType) {
    if (!policy.allowedVisitorTypes.includes(parsed.data.visitorType)) {
      return fail(409, `${parsed.data.visitorType} visitors are not permitted at ${amenity.name}`);
    }
  }

  // Visitor timing window, evaluated in the society's timezone.
  if (policy.allowedFrom && policy.allowedTo) {
    const timezone = await getTimezone(g.societyId);
    const nowMins = minutesOfDay(new Date(), timezone);
    if (nowMins < toMinutes(policy.allowedFrom) || nowMins > toMinutes(policy.allowedTo)) {
      return fail(409, `Visitors are only allowed between ${policy.allowedFrom} and ${policy.allowedTo}`);
    }
  }

  // Per-resident cap, counted for today only.
  if (policy.maxVisitorsPerResident && parsed.data.hostMemberId) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const already = await AmenityVisitor.countDocuments({
      amenityId: amenity._id,
      hostMemberId: parsed.data.hostMemberId,
      status: { $in: ["PENDING", "APPROVED", "CHECKED_IN", "CHECKED_OUT"] },
      createdAt: { $gte: startOfToday },
    });
    if (already + (parsed.data.partySize || 1) > policy.maxVisitorsPerResident) {
      return fail(
        409,
        `This flat has reached today's limit of ${policy.maxVisitorsPerResident} visitor(s) for ${amenity.name}`,
      );
    }
  }

  const requiresApproval = Boolean(policy.approvalRequired);

  const visitor = await AmenityVisitor.create({
    ...parsed.data,
    societyId: g.societyId,
    amenityName: amenity.name,
    status: requiresApproval ? "PENDING" : "APPROVED",
    approvedBy: requiresApproval ? null : g.actor.userId,
    approvedAt: requiresApproval ? null : new Date(),
    createdBy: g.actor.userId,
  });

  await logAmenityActivity({
    societyId: g.societyId,
    entityType: "VISITOR",
    entityId: visitor._id,
    amenityId: amenity._id,
    amenityName: amenity.name,
    action: ACTIVITY_ACTION.VISITOR_REGISTERED,
    actor: g.actor,
    newValue: { visitorName: visitor.visitorName, status: visitor.status, partySize: visitor.partySize },
  });

  return created({ visitor, requiresApproval });
});

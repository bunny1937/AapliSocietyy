import Amenity from "@/models/amenities/Amenity";
import AmenityCategory from "@/models/amenities/AmenityCategory";
import AmenityAvailability from "@/models/amenities/AmenityAvailability";
import { amenityCreateSchema } from "@/lib/amenities/schemas";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION, AMENITY_STATUS } from "@/lib/amenities/constants";
import { capacitySnapshot } from "@/lib/amenities/attendanceService";
import { resolveEffectiveStatus } from "@/lib/amenities/availability";
import { regenerateSlots } from "@/lib/amenities/slotEngine";
import { getSettings } from "@/lib/amenities/settingsService";
import {
  CAPABILITY, gate, ok, created, fail, zodFail, paging, pageMeta, withAmenityRoute,
} from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/amenities
// Filters: categoryId, status, search, includeInactive, attendanceMode, page, limit
export const GET = withAmenityRoute(async (request) => {
 const g = await gate(request, CAPABILITY.VIEW_AMENITIES);
if (!g.ok) return g.response;

  const { searchParams } = new URL(request.url);
  const { page, limit, skip } = paging(searchParams, { defaultLimit: 25 });

  const filter = { societyId: g.societyId, isDeleted: false };
  if (searchParams.get("includeInactive") !== "true") filter.isActive = true;
  if (searchParams.get("categoryId")) filter.categoryId = searchParams.get("categoryId");
  if (searchParams.get("status")) filter.status = searchParams.get("status");
  if (searchParams.get("attendanceMode")) filter.attendanceMode = searchParams.get("attendanceMode");

  const search = searchParams.get("search");
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ name: rx }, { location: rx }, { description: rx }];
  }

 const [rows, total, settings] = await Promise.all([
  Amenity.find(filter).sort({ displayOrder: 1, name: 1 }).skip(skip).limit(limit).lean(),
  Amenity.countDocuments(filter),
  getSettings(g.societyId),
]);

  // Effective status is resolved per row so the list reflects maintenance and
  // closures, not just the stored status field.
  const amenities = await Promise.all(rows.map(async (a) => ({
    ...a,
    capacitySnapshot: capacitySnapshot(a),
    effectiveStatus: await resolveEffectiveStatus({ amenity: a, timezone: settings.timezone }),
  })));

  return ok({ amenities, pagination: pageMeta({ page, limit, total }) });
});

// POST /api/amenities
export const POST = withAmenityRoute(async (request) => {
  const g = await gate(request, CAPABILITY.MANAGE_AMENITIES);
  if (!g.ok) return g.response;

  const parsed = amenityCreateSchema.safeParse(await request.json());
  if (!parsed.success) return zodFail(parsed);
  const body = parsed.data;

  const category = await AmenityCategory.findOne({
    _id: body.categoryId, societyId: g.societyId, isDeleted: false,
  }).select("_id name").lean();
  if (!category) return fail(404, "That category could not be found");

  const clash = await Amenity.findOne({
    societyId: g.societyId,
    isDeleted: false,
    name: new RegExp(`^${body.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
  }).select("_id").lean();
  if (clash) return fail(409, `An amenity named "${body.name}" already exists`);

  // Custom access roles must exist in society settings, otherwise the amenity
  // would reference a role nobody can ever hold.
  if (body.access?.audience === "CUSTOM") {
    const settings = await getSettings(g.societyId);
    const known = settings.customAccessRoles || [];
    const unknown = (body.access.customRoles || []).filter((r) => !known.includes(r));
    if (unknown.length) {
      return fail(422,
        `These roles are not configured for your society: ${unknown.join(", ")}. Add them in Amenities settings first.`,
        { availableRoles: known });
    }
  }

  let displayOrder = body.displayOrder;
  if (displayOrder == null) {
    const last = await Amenity.findOne({ societyId: g.societyId, categoryId: body.categoryId, isDeleted: false })
      .sort({ displayOrder: -1 }).select("displayOrder").lean();
    displayOrder = (last?.displayOrder ?? -1) + 1;
  }

  const amenity = await Amenity.create({
    ...body,
    displayOrder,
    categoryName: category.name,
    societyId: g.societyId,
    status: AMENITY_STATUS.OPEN,
    createdBy: g.actor.userId,
  });

  // Seed the weekly availability grid from the operating days/hours so the
  // amenity is immediately usable without a second configuration step.
  const days = body.operatingDays || amenity.operatingDays || [];
  if (days.length) {
    await AmenityAvailability.insertMany(days.map((d) => ({
      societyId: g.societyId,
      amenityId: amenity._id,
      type: "WEEKLY",
      dayOfWeek: d,
      openTime: amenity.openingTime,
      closeTime: amenity.closingTime,
      isActive: true,
    })), { ordered: false }).catch(() => {});
  }

  // Build the slot grid straight away when slots were enabled at creation.
  let slots = null;
  if (amenity.slotPolicy?.enabled) {
    slots = await regenerateSlots({ amenity: amenity.toObject() }).catch((err) => ({ error: err.message }));
  }

  await AmenityCategory.findByIdAndUpdate(body.categoryId, { $inc: { amenityCount: 1 } });

  await logAmenityActivity({
    societyId: g.societyId,
    entityType: "AMENITY",
    entityId: amenity._id,
    amenityId: amenity._id,
    amenityName: amenity.name,
    action: ACTIVITY_ACTION.AMENITY_CREATED,
    actor: g.actor,
    newValue: {
      name: amenity.name,
      categoryName: category.name,
      attendanceMode: amenity.attendanceMode,
      slotsEnabled: Boolean(amenity.slotPolicy?.enabled),
    },
  });

  return created({
    amenity,
    slotsCreated: slots?.created ?? 0,
    ...(slots?.error ? { slotWarning: slots.error } : {}),
  });
});

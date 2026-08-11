import AmenityCategory from "@/models/amenities/AmenityCategory";
import Amenity from "@/models/amenities/Amenity";
import { categoryCreateSchema } from "@/lib/amenities/schemas";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION } from "@/lib/amenities/constants";
import { CAPABILITY, gate, ok, created, fail, zodFail, withAmenityRoute } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/amenities/categories?includeInactive=true&withCounts=true
export const GET = withAmenityRoute(async (request) => {
  const g = await gate(request, CAPABILITY.VIEW_AMENITIES);
  if (!g.ok) return g.response;

  const { searchParams } = new URL(request.url);
  const includeInactive = searchParams.get("includeInactive") === "true";

  const categories = await AmenityCategory.find({
    societyId: g.societyId,
    isDeleted: false,
    ...(includeInactive ? {} : { isActive: true }),
  })
    .sort({ displayOrder: 1, name: 1 })
    .lean();

  // Live counts rather than the denormalised amenityCount when asked for, so the
  // management screen never shows a stale number after a bulk change.
  if (searchParams.get("withCounts") === "true" && categories.length) {
    const counts = await Amenity.aggregate([
      { $match: { societyId: categories[0].societyId, isDeleted: false } },
      { $group: { _id: "$categoryId", count: { $sum: 1 }, active: { $sum: { $cond: ["$isActive", 1, 0] } } } },
    ]);
    const map = new Map(counts.map((c) => [String(c._id), c]));
    for (const cat of categories) {
      const hit = map.get(String(cat._id));
      cat.amenityCount = hit?.count || 0;
      cat.activeAmenityCount = hit?.active || 0;
    }
  }

  return ok({ categories, total: categories.length });
});

// POST /api/amenities/categories
export const POST = withAmenityRoute(async (request) => {
  const g = await gate(request, CAPABILITY.MANAGE_CATEGORIES);
  if (!g.ok) return g.response;

  const parsed = categoryCreateSchema.safeParse(await request.json());
  if (!parsed.success) return zodFail(parsed);
  const body = parsed.data;

  // Case-insensitive duplicate check. "Sports" and "sports" in one sidebar is a
  // data-entry mistake, not two categories.
  const clash = await AmenityCategory.findOne({
    societyId: g.societyId,
    isDeleted: false,
    name: new RegExp(`^${body.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
  }).select("_id").lean();
  if (clash) return fail(409, `A category named "${body.name}" already exists`);

  // Appended to the end unless the admin specified a position.
  let displayOrder = body.displayOrder;
  if (displayOrder == null) {
    const last = await AmenityCategory.findOne({ societyId: g.societyId, isDeleted: false })
      .sort({ displayOrder: -1 }).select("displayOrder").lean();
    displayOrder = (last?.displayOrder ?? -1) + 1;
  }

  const category = await AmenityCategory.create({
    ...body,
    displayOrder,
    societyId: g.societyId,
    createdBy: g.actor.userId,
  });

  await logAmenityActivity({
    societyId: g.societyId,
    entityType: "CATEGORY",
    entityId: category._id,
    action: ACTIVITY_ACTION.CATEGORY_CREATED,
    actor: g.actor,
    newValue: { name: category.name, displayOrder },
  });

  return created({ category });
});

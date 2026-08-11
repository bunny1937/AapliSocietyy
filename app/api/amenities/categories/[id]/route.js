import AmenityCategory from "@/models/amenities/AmenityCategory";
import Amenity from "@/models/amenities/Amenity";
import { categoryUpdateSchema } from "@/lib/amenities/schemas";
import { logAmenityActivity, logUpdate } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION } from "@/lib/amenities/constants";
import { CAPABILITY, gate, ok, fail, zodFail, isId, withAmenityRoute } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.VIEW_AMENITIES);
  if (!g.ok) return g.response;

  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid category id");

  const category = await AmenityCategory.findOne({
    _id: id, societyId: g.societyId, isDeleted: false,
  }).lean();
  if (!category) return fail(404, "Category not found");

  const amenities = await Amenity.find({ categoryId: id, isDeleted: false })
    .select("name status isActive displayOrder")
    .sort({ displayOrder: 1, name: 1 })
    .lean();

  return ok({ category, amenities });
});

export const PATCH = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.MANAGE_CATEGORIES);
  if (!g.ok) return g.response;

  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid category id");

  const parsed = categoryUpdateSchema.safeParse(await request.json());
  if (!parsed.success) return zodFail(parsed);
  const body = parsed.data;

  const before = await AmenityCategory.findOne({ _id: id, societyId: g.societyId, isDeleted: false }).lean();
  if (!before) return fail(404, "Category not found");

  if (body.name) {
    const clash = await AmenityCategory.findOne({
      societyId: g.societyId,
      isDeleted: false,
      _id: { $ne: id },
      name: new RegExp(`^${body.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
    }).select("_id").lean();
    if (clash) return fail(409, `A category named "${body.name}" already exists`);
  }

  const after = await AmenityCategory.findByIdAndUpdate(
    id,
    { $set: { ...body, updatedBy: g.actor.userId } },
    { new: true },
  ).lean();

  // Deactivating a category hides its amenities from residents without
  // touching each amenity's own isActive flag, so re-enabling restores the
  // previous per-amenity state exactly.
  await logUpdate({
    societyId: g.societyId,
    entityType: "CATEGORY",
    entityId: id,
    action: ACTIVITY_ACTION.CATEGORY_UPDATED,
    actor: g.actor,
    prev: before,
    next: body,
  });

  return ok({ category: after });
});

// DELETE /api/amenities/categories/[id]
// Soft delete, and refused while amenities still reference the category:
// orphaning amenities would strand them out of every listing.
export const DELETE = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.MANAGE_CATEGORIES);
  if (!g.ok) return g.response;

  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid category id");

  const category = await AmenityCategory.findOne({ _id: id, societyId: g.societyId, isDeleted: false }).lean();
  if (!category) return fail(404, "Category not found");

  const inUse = await Amenity.countDocuments({ categoryId: id, isDeleted: false });
  if (inUse > 0) {
    return fail(409,
      `This category still has ${inUse} amenit${inUse === 1 ? "y" : "ies"}. Move or delete them first, or mark the category inactive instead.`,
      { amenityCount: inUse });
  }

  await AmenityCategory.findByIdAndUpdate(id, {
    $set: { isDeleted: true, deletedAt: new Date(), isActive: false, updatedBy: g.actor.userId },
  });

  await logAmenityActivity({
    societyId: g.societyId,
    entityType: "CATEGORY",
    entityId: id,
    action: ACTIVITY_ACTION.CATEGORY_DELETED,
    actor: g.actor,
    oldValue: { name: category.name },
  });

  return ok({ deleted: true });
});

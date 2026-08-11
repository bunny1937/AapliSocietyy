import AmenityCategory from "@/models/amenities/AmenityCategory";
import { reorderSchema } from "@/lib/amenities/schemas";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION } from "@/lib/amenities/constants";
import { CAPABILITY, gate, ok, fail, zodFail, withAmenityRoute } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/amenities/categories/reorder
// One call for the whole drag-and-drop result. Sending N separate PATCHes would
// leave the sidebar in a half-ordered state if the network dropped mid-way.
export const POST = withAmenityRoute(async (request) => {
  const g = await gate(request, CAPABILITY.MANAGE_CATEGORIES);
  if (!g.ok) return g.response;

  const parsed = reorderSchema.safeParse(await request.json());
  if (!parsed.success) return zodFail(parsed);
  const { order } = parsed.data;

  // Every id must belong to this society before anything is written.
  const ids = order.map((o) => o.id);
  const owned = await AmenityCategory.countDocuments({
    _id: { $in: ids }, societyId: g.societyId, isDeleted: false,
  });
  if (owned !== ids.length) return fail(404, "One or more categories could not be found");

  await AmenityCategory.bulkWrite(order.map((o) => ({
    updateOne: {
      filter: { _id: o.id, societyId: g.societyId },
      update: { $set: { displayOrder: o.displayOrder, updatedBy: g.actor.userId } },
    },
  })));

  await logAmenityActivity({
    societyId: g.societyId,
    entityType: "CATEGORY",
    action: ACTIVITY_ACTION.CATEGORIES_REORDERED,
    actor: g.actor,
    newValue: { count: order.length },
    note: `Reordered ${order.length} categories`,
  });

  const categories = await AmenityCategory.find({ societyId: g.societyId, isDeleted: false })
    .sort({ displayOrder: 1, name: 1 })
    .lean();

  return ok({ categories });
});

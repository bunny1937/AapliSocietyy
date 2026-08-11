import AmenityActivityLog from "@/models/amenities/AmenityActivityLog";
import {
  gate, ok, fail, isId, paging, pageMeta, dateRange,
  withAmenityRoute, CAPABILITY,
} from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/amenities/activity-log?amenityId=&entityType=&action=&userId=&from=&to=
//
// Read-only by design: there is no write, edit or delete endpoint for the audit
// trail, which is what makes it worth trusting.
export const GET = withAmenityRoute(async (request) => {
  const g = await gate(request, CAPABILITY.VIEW_ACTIVITY_LOG);
  if (!g.ok) return g.response;

  const sp = new URL(request.url).searchParams;
  const { page, limit, skip } = paging(sp, { defaultLimit: 50, maxLimit: 200 });
  const range = dateRange(sp, { defaultDays: 30 });
  if (!range) return fail(422, "Invalid date range");

  const filter = { societyId: g.societyId, createdAt: { $gte: range.from, $lte: range.to } };
  if (isId(sp.get("amenityId"))) filter.amenityId = sp.get("amenityId");
  if (sp.get("entityType")) filter.entityType = sp.get("entityType");
  if (sp.get("action")) filter.action = sp.get("action");
  if (isId(sp.get("userId"))) filter["actor.userId"] = sp.get("userId");

  const q = sp.get("q")?.trim();
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ amenityName: rx }, { "actor.name": rx }, { note: rx }];
  }

  const [entries, total, actionFacets] = await Promise.all([
    AmenityActivityLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AmenityActivityLog.countDocuments(filter),
    // Drives the filter dropdown from what actually happened, so the list never
    // offers an action with zero results.
    AmenityActivityLog.aggregate([
      { $match: { societyId: g.societyId, createdAt: { $gte: range.from, $lte: range.to } } },
      { $group: { _id: "$action", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  return ok({ entries, actionFacets, pagination: pageMeta({ page, limit, total }), range });
});

import { withRoute, json } from "@/lib/v1/http";
import { getClaims } from "@/lib/v1/auth";
import connectDB from "@/lib/mongodb";
import Amenity from "@/models/amenities/Amenity";
import AmenityCategory from "@/models/amenities/AmenityCategory";
import { memberContext, publicAmenity } from "@/lib/amenities/memberContext";
import { resolveEffectiveStatus } from "@/lib/amenities/availability";
import { checkEligibility } from "@/lib/amenities/permissions";
import { getTimezone } from "@/lib/amenities/settingsService";
import cache from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Eligibility/effective-status are per-resident (age, occupancy, role) and
// must never be cached, but the underlying amenity/category rows are the
// same for the whole society regardless of who's asking. Caching the
// unfiltered set (categoryId/q filters applied in JS afterward, on data
// already in memory) keeps one cache key per society instead of one per
// filter combination.
async function fetchAmenityData(societyId) {
  const [rows, categories, timezone] = await Promise.all([
    Amenity.find({ societyId, isDeleted: false, isActive: true }).sort({ displayOrder: 1, name: 1 }).lean(),
    AmenityCategory.find({ societyId, isDeleted: false, isActive: true })
      .sort({ displayOrder: 1, name: 1 })
      .lean(),
    getTimezone(societyId),
  ]);
  return { rows, categories, timezone };
}

// GET /api/v1/amenities
//
// The resident amenities list, grouped by category. Every row already carries
// its effective status and whether *this* resident may use it, so the app never
// has to reimplement the rules and can render an honest, greyed-out card with a
// reason instead of a broken check-in.
export const GET = withRoute(async (request) => {
  const claims = await getClaims(request);
  await connectDB();
  const ctx = await memberContext(claims, request);

  const sp = new URL(request.url).searchParams;
  const categoryId = sp.get("categoryId");
  const q = sp.get("q")?.trim();

  const { rows: allRows, categories, timezone } = await cache.getOrSetSWR(
    `v1:amenities:${ctx.societyId}`,
    () => fetchAmenityData(ctx.societyId),
    { softTtlSeconds: 30, hardTtlSeconds: 120 },
  );

  let rows = allRows;
  if (categoryId) rows = rows.filter((a) => String(a.categoryId) === String(categoryId));
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    rows = rows.filter((a) => rx.test(a.name || "") || rx.test(a.location || ""));
  }

  const categoryById = new Map(categories.map((c) => [String(c._id), c]));

  const amenities = await Promise.all(
    rows.map(async (a) => {
      const effective = await resolveEffectiveStatus({ amenity: a, timezone });
      const eligibility = checkEligibility({
        amenity: a,
        occupancyType: ctx.occupancyType,
        role: ctx.role,
        age: ctx.age,
      });
      return publicAmenity(
        { ...a, categoryName: categoryById.get(String(a.categoryId))?.name || "" },
        { effective, eligibility },
      );
    }),
  );

  // Grouped payload so the app renders sections without a second pass, but the
  // flat list is included too for search results.
  const grouped = categories
    .map((c) => ({
      categoryId: c._id,
      name: c.name,
      description: c.description || "",
      amenities: amenities.filter((a) => String(a.categoryId) === String(c._id)),
    }))
    .filter((group) => group.amenities.length > 0);

  return json({ amenities, categories: grouped });
});

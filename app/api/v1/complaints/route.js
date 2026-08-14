import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { complaintSchema } from "@/lib/v1/schemas";
import { Complaint } from "@/lib/v1/models";
import { SOCIETY_ADMIN_ROLES } from "@/lib/v1/constants";
import { generateAnonymousName } from "@/lib/v1/anonymousName";
import cache from "@/lib/cache";

// Scoped per-viewer: admins see the whole society's list, members see only
// their own — these must never share a cache key or a member's filtered view
// could serve an admin's full list (or vice versa).
const complaintsKey = (societyId, claims) =>
  SOCIETY_ADMIN_ROLES.includes(claims.role)
    ? `v1:complaints:${societyId}:all`
    : `v1:complaints:${societyId}:member:${claims.memberId}`;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hide the real member behind the anonymous handle unless the viewer is an
// admin/secretary (parity with the web complaint board).
function present(c, claims) {
  const isAdmin = SOCIETY_ADMIN_ROLES.includes(claims.role);
  const own = String(c.memberId) === String(claims.memberId);
  return {
    _id: String(c._id),
    category: c.category,
    title: c.title,
    description: c.description,
    status: c.status,
    anonymous: c.anonymous,
    anonymousName: c.anonymousName,
    resolutionNote: c.resolutionNote ?? null,
    createdAt: c.createdAt,
    memberId: isAdmin || own ? String(c.memberId) : undefined,
  };
}

// GET /v1/complaints — admins see all society complaints; members see only
// their own. Raw docs are cached per scope (soft 15s / hard 60s — shorter
// than notices since a member filing a complaint wants fast visible
// feedback); present() still runs fresh per request off the cached data so
// per-viewer masking is never stale or shared across viewers.
export const GET = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  const isAdmin = SOCIETY_ADMIN_ROLES.includes(claims.role);
  if (!isAdmin && !claims.memberId) return json({ complaints: [] });

  const query = { societyId };
  if (!isAdmin) query.memberId = claims.memberId;

  const complaints = await cache.getOrSetSWR(
    complaintsKey(societyId, claims),
    () => Complaint.find(query).sort({ createdAt: -1 }).limit(200).lean(),
    { softTtlSeconds: 15, hardTtlSeconds: 60 },
  );
  return json({ complaints: complaints.map((c) => present(c, claims)) });
});

// POST /v1/complaints — a resident files a complaint.
export const POST = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  if (!claims.memberId) throw new ApiError(403, "Only residents can file complaints");
  const body = await req.json().catch(() => ({}));
  const parsed = complaintSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);
  const data = parsed.data;

  const complaint = await Complaint.create({
    societyId,
    memberId: claims.memberId,
    anonymousName: generateAnonymousName(),
    category: data.category,
    title: data.title,
    description: data.description,
    anonymous: !!data.anonymous,
    status: "PENDING",
  });
  // The filer wants to see their own complaint immediately; admins need it
  // in their queue immediately too.
  await cache.del(complaintsKey(societyId, claims), `v1:complaints:${societyId}:all`);
  return json({ complaint: present(complaint, claims) }, { status: 201 });
});

import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { tenantRequestCreateSchema } from "@/lib/v1/schemas";
import { TenantRequest, Member } from "@/lib/v1/models";
import { SOCIETY_ADMIN_ROLES, OCCUPANCY_TYPES } from "@/lib/v1/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /v1/tenant-requests — admins see all society requests; owners see their
// own flat's requests.
export const GET = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  const query = { societyId };
  if (!SOCIETY_ADMIN_ROLES.includes(claims.role)) {
    if (!claims.memberId) return json({ requests: [] });
    query.memberId = claims.memberId;
  }
  const requests = await TenantRequest.find(query).sort({ createdAt: -1 }).limit(200).lean();
  return json({ requests: requests.map((r) => ({ ...r, _id: String(r._id) })) });
});

// POST /v1/tenant-requests — an owner submits a tenant onboarding request with
// pre-uploaded document keys (see /v1/tenant-requests/upload/:field).
export const POST = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  if (!claims.memberId) throw new ApiError(403, "Only residents can submit tenant requests");
  if (claims.occupancyType === OCCUPANCY_TYPES.TENANT) {
    throw new ApiError(403, "Only owners can onboard tenants");
  }
  const body = await req.json().catch(() => ({}));
  const parsed = tenantRequestCreateSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);
  const data = parsed.data;

  const member = await Member.findOne({ _id: claims.memberId, societyId }).select("_id");
  if (!member) throw new ApiError(404, "Member not found");

  const request = await TenantRequest.create({
    societyId,
    memberId: member._id,
    requestedByUserId: claims.userId,
    tenantName: data.tenantName,
    tenantPhone: data.tenantPhone,
    tenantEmail: data.tenantEmail,
    leaseStartDate: new Date(data.leaseStartDate),
    leaseEndDate: new Date(data.leaseEndDate),
    rentPerMonth: data.rentPerMonth,
    depositAmount: data.depositAmount ?? 0,
    documents: data.documents,
    acknowledgement: {
      by: claims.userId,
      byName: claims.name || null,
      at: new Date(),
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    },
    status: "Pending",
  });
  return json({ request: { ...request.toObject(), _id: String(request._id) } }, { status: 201 });
});

import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { TenantRequest, Member } from "@/lib/v1/models";
import { markDocumentsExpiring } from "@/lib/tenancy/documentRetention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only the flat's owner may drive these lifecycle actions.
async function ownerRequest(req, id) {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  if (claims.occupancyType === "Tenant") throw new ApiError(403, "Only the owner can manage the tenancy");
  const request = await TenantRequest.findOne({ _id: id, societyId });
  if (!request) throw new ApiError(404, "Tenant request not found");
  if (String(request.memberId) !== String(claims.memberId)) throw new ApiError(403, "Not your tenancy");
  return { claims, societyId, request };
}

// POST /v1/tenant-requests/:id/end-lease - owner ends an active tenancy. This
// records the owner's half of the two-party move-out; the admin still confirms
// via confirm-move-out before the tenancy closes and the login is disabled.
export const POST = withRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const { request } = await ownerRequest(req, id);
  if (request.status === "Closed") throw new ApiError(409, "Tenancy already closed");
  if (request.status !== "Approved") throw new ApiError(409, "Only an approved tenancy can be ended");

  const body = await req.json().catch(() => ({}));
  const now = new Date();
  request.leaseEndDate = body.leaseEndDate ? new Date(body.leaseEndDate) : request.leaseEndDate || now;
  request.leaseExpiredAt = request.leaseExpiredAt || now;
  markDocumentsExpiring(request, request.leaseExpiredAt);
  request.ownerConfirmedMoveOutAt = request.ownerConfirmedMoveOutAt || now;
  if (body.note) request.notes = [...(request.notes || []), { text: body.note, at: now, by: "Owner" }];
  await request.save();

  await Member.updateOne(
    { _id: request.memberId, "currentTenant.tenantRequestId": request._id },
    { $set: { "currentTenant.leaseEndDate": request.leaseEndDate, "currentTenant.endRequestedAt": now } },
  ).catch(() => {});

  return json({
    tenantRequest: { ...request.toObject(), _id: String(request._id) },
    message: "Lease end recorded. Awaiting admin confirmation to close the tenancy.",
  });
});

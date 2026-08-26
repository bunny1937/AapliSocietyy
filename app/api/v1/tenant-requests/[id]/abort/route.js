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

// POST /v1/tenant-requests/:id/abort - owner withdraws a request the admin has
// not acted on yet.
export const POST = withRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const { request } = await ownerRequest(req, id);
  if (request.status !== "Pending") throw new ApiError(409, "Only a pending request can be aborted");
  request.status = "Rejected";
  // Nothing came of this tenancy, so its documents start their clock now.
  markDocumentsExpiring(request);
  request.rejectionReason = "Withdrawn by the owner";
  await request.save();
  return json({ success: true, message: "Request withdrawn" });
});

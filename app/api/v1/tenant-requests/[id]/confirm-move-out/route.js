import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { TenantRequest, Member } from "@/lib/v1/models";
import { SOCIETY_ADMIN_ROLES } from "@/lib/v1/constants";
import { markDocumentsExpiring } from "@/lib/tenancy/documentRetention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /v1/tenant-requests/:id/confirm-move-out — two-party move-out finalize.
// Both the owner and an admin must confirm; once both timestamps are set the
// tenancy is pushed to the member's tenantHistory, currentTenant is cleared,
// and the request is Closed. Mirrors the mobile controller exactly.
export const POST = withRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const claims = getClaims(req);
  const societyId = requireTenant(claims);

  const request = await TenantRequest.findOne({ _id: id, societyId });
  if (!request) throw new ApiError(404, "Tenant request not found");
  if (request.status === "Closed") throw new ApiError(409, "Tenancy already closed");

  const isAdmin = SOCIETY_ADMIN_ROLES.includes(claims.role);
  const isOwner = String(request.memberId) === String(claims.memberId);
  if (!isAdmin && !isOwner) throw new ApiError(403, "Not authorized for this tenancy");

  const now = new Date();
  if (isOwner) request.ownerConfirmedMoveOutAt = request.ownerConfirmedMoveOutAt || now;
  if (isAdmin) request.adminConfirmedMoveOutAt = request.adminConfirmedMoveOutAt || now;

  const bothConfirmed = request.ownerConfirmedMoveOutAt && request.adminConfirmedMoveOutAt;
  if (bothConfirmed) {
    request.status = "Closed";
    request.leaseExpiredAt = request.leaseExpiredAt || now;
    markDocumentsExpiring(request, request.leaseExpiredAt);
    await Member.updateOne(
      { _id: request.memberId },
      {
        $unset: { currentTenant: "" },
        $push: {
          tenantHistory: {
            tenantName: request.tenantName,
            tenantPhone: request.tenantPhone,
            tenantEmail: request.tenantEmail,
            leaseStartDate: request.leaseStartDate,
            leaseEndDate: request.leaseEndDate,
            rentPerMonth: request.rentPerMonth,
            depositAmount: request.depositAmount,
            movedOutAt: now,
            tenantRequestId: request._id,
          },
        },
      },
    );
  }
  await request.save();

  return json({
    request: { _id: String(request._id), status: request.status },
    ownerConfirmed: !!request.ownerConfirmedMoveOutAt,
    adminConfirmed: !!request.adminConfirmedMoveOutAt,
    closed: !!bothConfirmed,
  });
});

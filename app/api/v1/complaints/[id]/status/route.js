import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims, requireRoles, requireTenant } from "@/lib/v1/auth";
import { complaintStatusSchema } from "@/lib/v1/schemas";
import { Complaint } from "@/lib/v1/models";
import { SOCIETY_ADMIN_ROLES } from "@/lib/v1/constants";
import { complaintStatusWritesEnabled } from "@/lib/v1/config";
import { notifyComplaintDecision } from "@/lib/v1/notify";
import cache from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /v1/complaints/:id/status — admin updates a complaint's status. GATED
// by COMPLAINT_STATUS_WRITES_ENABLED (off by default) because the web app owns
// the canonical complaint status vocabulary/workflow.
export const PATCH = withRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  requireRoles(claims, SOCIETY_ADMIN_ROLES);
  if (!complaintStatusWritesEnabled()) {
    throw new ApiError(403, "Complaint status updates from the mobile app are disabled");
  }
  const body = await req.json().catch(() => ({}));
  const parsed = complaintStatusSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);

  const complaint = await Complaint.findOne({ _id: id, societyId });
  if (!complaint) throw new ApiError(404, "Complaint not found");
  complaint.status = parsed.data.status;
  if (parsed.data.resolutionNote) complaint.resolutionNote = parsed.data.resolutionNote;
  await complaint.save();

  await notifyComplaintDecision({
    complaintId: complaint._id,
    societyId,
    memberId: complaint.memberId,
    status: complaint.status,
  });
  // Both the admin queue and the filer's own list carry the old status
  // until these are cleared — a decision should be visible right away.
  await cache.del(
    `v1:complaints:${societyId}:all`,
    `v1:complaints:${societyId}:member:${complaint.memberId}`,
  );
  return json({ complaint: { _id: String(complaint._id), status: complaint.status } });
});

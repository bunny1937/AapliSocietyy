// GET /v1/tenant-requests/:id/documents/:field
//
// This route DID NOT EXIST for the mobile app. Only the admin web console had
// a way to actually open a tenancy document (see
// app/api/admin/tenant-requests/[id]/documents/[field]/route.js). That is why
// the owner app could tell you a document was "on file" but never show it to
// you: there was no endpoint to ask for it.
//
// Returns a short-lived presigned R2 download URL. The phone fetches the file
// straight from R2; this route never buffers it.
import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { TenantRequest } from "@/lib/v1/models";
import { presignTenantDocumentDownload } from "@/lib/tenant-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIELD_MAP = {
  contract: "contractKey",
  // signature removed — replaced by the in-app acknowledgement.
  // aadhaar removed — no longer collected, and legacy keys are not served (D1).
  policeVerification: "policeVerificationKey",
};

// Either party on the lease may open the documents. The tenant uploaded most of
// them and must be able to check what their owner is looking at; the owner must
// be able to review them. Same guard shape as the sibling notes/documents
// routes.
async function tenancyForCaller(req, id) {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  if (!claims.memberId) throw new ApiError(403, "Only residents can view tenancy documents");
  const request = await TenantRequest.findOne({ _id: id, societyId }).lean();
  if (!request) throw new ApiError(404, "Tenant request not found");
  if (String(request.memberId) !== String(claims.memberId)) throw new ApiError(403, "Not your tenancy");
  return request;
}

export const GET = withRoute(async (req, ctx) => {
  const { id, field } = await ctx.params;
  const keyField = FIELD_MAP[field];
  if (!keyField) throw new ApiError(400, `Unknown document field: ${field}`);

  const request = await tenancyForCaller(req, id);
  // Tolerate both storage shapes: `contractKey` (what the upload route writes)
  // and a bare `contract` (older add-tenant payloads).
  const key = request.documents?.[keyField] || request.documents?.[field];
  if (!key) throw new ApiError(404, "Document not uploaded");

  const url = await presignTenantDocumentDownload(key);
  return json({ ok: true, url });
});

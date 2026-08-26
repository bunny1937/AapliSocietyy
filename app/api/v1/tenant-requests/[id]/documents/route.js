import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { TenantRequest, Member } from "@/lib/v1/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Either the flat's owner OR the approved tenant may attach a document here —
// the tenant-side "My Documents" upload flow reuses this same route to attach
// its own post-approval documents (see tenant_profile_page.dart's
// `_uploadDoc`), so an owner-only guard 403'd every tenant self-upload.
async function tenancyForCaller(req, id) {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  if (!claims.memberId) throw new ApiError(403, "Only residents can manage tenancy documents");
  const request = await TenantRequest.findOne({ _id: id, societyId }).lean();
  if (!request) throw new ApiError(404, "Tenant request not found");
  if (String(request.memberId) !== String(claims.memberId)) throw new ApiError(403, "Not your tenancy");
  return { claims, societyId, request };
}

const FIELD_MAP = {
  contract: "contractKey",
  // signature removed — replaced by the in-app acknowledgement.
  // aadhaar removed — no longer collected, and legacy keys are not served (D1).
  policeVerification: "policeVerificationKey",
};

// POST /v1/tenant-requests/:id/documents - owner attaches a document that was
// missing at onboarding (key comes from /tenant-requests/upload/:field).
export const POST = withRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const { request } = await tenancyForCaller(req, id);
  const body = await req.json().catch(() => ({}));
  const key = FIELD_MAP[body.field];
  if (!key) throw new ApiError(400, `Unknown document field: ${body.field}`);
  if (!body.key) throw new ApiError(400, "Missing uploaded object key");
  // Targeted updateOne, not request.save() — a full-document .save() on an
  // older TenantRequest (e.g. one created before a schema field like
  // loginEnabled/noteThread existed) re-validates the ENTIRE document and can
  // 500 on something completely unrelated to the one field being changed.
  await TenantRequest.updateOne(
    { _id: request._id },
    { $set: { [`documents.${key}`]: body.key } },
  );
  const updated = await TenantRequest.findById(request._id).select("documents").lean();
  return json({ documents: updated?.documents || {}, message: "Document attached" });
});

// PATCH /v1/tenant-requests/:id/documents - the owner ACCEPTS a document, or
// sends it back with a reason.
//
// There was no review step at all before this. A tenant uploaded their lease
// and the owner's only feedback channel was... nothing. No accept, no reject,
// no reason, no notification. The document just sat there and the owner had no
// way to even open it. A blurred Aadhaar photo could not be refused.
//
// The verdict is stored alongside the key as `<field>Review`, so it travels
// with the document and both sides read the same object.
const REVIEW_FIELD = {
  contract: "contractReview",
  signature: "signatureReview",
  aadhaar: "aadhaarReview",
  policeVerification: "policeVerificationReview",
};

export const PATCH = withRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const { claims, request } = await tenancyForCaller(req, id);

  // Reviewing is the owner's call. A tenant approving their own paperwork
  // defeats the point of the step.
  if (claims.occupancyType === "Tenant") {
    throw new ApiError(403, "Only the flat owner can review tenancy documents");
  }

  const body = await req.json().catch(() => ({}));
  const keyField = FIELD_MAP[body.field];
  const reviewField = REVIEW_FIELD[body.field];
  if (!keyField || !reviewField) throw new ApiError(400, `Unknown document field: ${body.field}`);

  const action = String(body.action || "").toLowerCase();
  if (action !== "accept" && action !== "return") {
    throw new ApiError(400, "action must be 'accept' or 'return'");
  }

  // Nothing to review if nothing was uploaded.
  const storedKey = request.documents?.[keyField] || request.documents?.[body.field];
  if (!storedKey) throw new ApiError(409, "That document has not been uploaded yet");

  const reason = String(body.reason || "").trim();
  // Sending a document back without saying why is the behaviour being fixed,
  // not a shape to preserve.
  if (action === "return" && !reason) {
    throw new ApiError(400, "Tell your tenant why you are sending it back");
  }
  if (reason.length > 200) throw new ApiError(400, "Reason is too long (200 characters max)");

  const review = {
    status: action === "accept" ? "accepted" : "returned",
    reason: action === "accept" ? "" : reason,
    at: new Date(),
    by: "Owner",
  };

  // Targeted updateOne for the same reason as the POST above: a full .save()
  // re-validates the entire (possibly legacy) document.
  await TenantRequest.updateOne(
    { _id: request._id },
    { $set: { [`documents.${reviewField}`]: review } },
  );

  // The tenant needs to know, especially for a rejection - otherwise they are
  // waiting on an owner who is waiting on them.
  try {
    const { notifyTenancyNote } = await import("@/lib/v1/notify");
    await notifyTenancyNote({
      societyId: request.societyId,
      memberId: request.memberId,
      requestId: request._id,
      text:
        action === "accept"
          ? `Your owner accepted your ${body.field} document.`
          : `Your owner sent back your ${body.field} document: ${reason}`,
      fromTenant: false,
    });
  } catch (err) {
    // A notification failure must not fail the review itself.
    console.error("Tenancy document review notification failed", err);
  }

  const updated = await TenantRequest.findById(request._id).select("documents").lean();
  return json({
    documents: updated?.documents || {},
    message: action === "accept" ? "Document accepted" : "Document sent back to the tenant",
  });
});

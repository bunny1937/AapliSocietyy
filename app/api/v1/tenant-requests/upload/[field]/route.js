import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { detectFileType } from "@/lib/v1/fileSignature";
import { buildKey, uploadBuffer } from "@/lib/v1/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// D1, second half. We no longer take Aadhaar cards for tenant onboarding.
//
// The earlier reasoning for keeping this was that Maharashtra tenant police
// verification asks for photo ID, so removing it might break something the
// society owes the police. That reasoning was wrong about whose job it is.
// Police verification is between the owner, the tenant and the police. Us
// sitting in the middle of it added a scanned Aadhaar card — photo, address
// and QR, strictly worse than the bare number — to our storage for a duty
// that was never ours.
//
// So the field is refused on upload and dropped from the submission schema.
// The stored `aadhaarKey` on models/TenantRequest.js stays declared only so
// legacy rows still parse; nothing writes it and nothing serves it back.
// Existing objects are cleared by scripts/clear-tenant-aadhaar.mjs.
const FIELDS = { contract: "contract", policeVerification: "police-verification" };
const RETIRED_FIELDS = {
  signature:
    "Signatures are no longer uploaded. Tick the confirmation box on the form instead — it records who confirmed and when, which a scanned signature never did.",
  aadhaar:
    "Aadhaar cards are no longer collected. Police verification is between the owner, the tenant and the police — remove this document from your submission and continue.",
};
// 2MB, down from 10MB. A scanned leave-and-licence agreement is comfortably
// under this; 10MB only ever admitted a 40-page photo of one taken on a phone,
// which costs storage and egress forever and reads no better.
const MAX_BYTES = 2 * 1024 * 1024;

// POST /v1/tenant-requests/upload/:field — uploads one tenant document
// (multipart, field "file"). Returns the object key to embed in the request
// body. Replaces Multer with req.formData().
//
// Used by two different flows that both need it: the owner submitting a new
// tenant's onboarding documents (contract/police-verification), and
// an already-approved tenant uploading their own documents from "My
// Documents". This route only stages a file into storage and hands back its
// key — it does not write onto any specific TenantRequest — so there is no
// cross-tenant risk in letting either side call it. The tenant-only block
// here previously locked tenants out of their own document uploads entirely.
export const POST = withRoute(async (req, ctx) => {
  const { field } = await ctx.params;
  if (RETIRED_FIELDS[field]) throw new ApiError(410, RETIRED_FIELDS[field]);
  const folderPart = FIELDS[field];
  if (!folderPart) throw new ApiError(400, "Unknown document field");

  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  if (!claims.memberId) {
    throw new ApiError(403, "Only residents can upload tenant documents");
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") throw new ApiError(400, "file is required");
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > MAX_BYTES) throw new ApiError(413, "File too large (max 2MB). Scan or photograph the pages at a lower resolution.");
  const detected = detectFileType(buffer);
  if (!detected) throw new ApiError(400, "Only PDF, JPEG or PNG files are allowed");

  const ext = detected === "application/pdf" ? "pdf" : detected === "image/png" ? "png" : "jpg";
  const key = buildKey(societyId, `tenant-requests/${folderPart}`, ext);
  await uploadBuffer(key, buffer, detected);
  return json({ ok: true, field, key });
});

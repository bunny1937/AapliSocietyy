import { setting } from "@/lib/platform/settings";
// When a tenancy's documents stop being worth keeping.
//
// Nothing in the tenant-request flow used to expire. A tenant who moved out in
// 2019 still had their leave-and-licence agreement sitting in our bucket, and
// would have had it there in 2035. That is the same open-ended retention the
// society-offboarding work exists to close, in a different corner of the app.
//
// The cost of keeping it is not storage — a scanned agreement is well under a
// megabyte and storage is a rounding error. The cost is that every document
// held is a document that can leak, and a tenancy agreement carries the
// tenant's name, phone, address and rent. Holding one nobody will ever open
// again buys nothing and risks everything it can lose.
//
// ## Why three years, and not less
//
// The agreement is evidence. If a tenancy goes wrong — a deposit dispute, a
// damage claim, an eviction — the society may need to produce it, and those
// arguments do not always start promptly. Three years covers the ordinary
// limitation period for a contract claim in India with room to spare, without
// drifting into "we keep everything forever because deleting felt risky".
//
// Deliberately NOT tied to the society's own retention settings: this is a
// document about a person who has left, not a financial record the society is
// required to hold for tax.

const DAY_MS = 24 * 60 * 60 * 1000;

// Resolves database override -> env var -> 1095 (3 years). See
// lib/platform/settings.js; a superadmin can change this from the settings
// page. Shortening it only affects documents not yet marked — an expiry
// already stamped is never extended, which is the whole point of markDocuments
// Expiring() being idempotent.
export const TENANCY_DOCUMENT_RETENTION_DAYS = () =>
  setting("TENANCY_DOCUMENT_RETENTION_DAYS");

/**
 * The date a finished tenancy's documents become deletable.
 *
 * Returns null while the tenancy is live — an active tenant's agreement is in
 * use and must not be on a clock. Anything that ends a tenancy calls this;
 * nothing else does.
 *
 * @param endedAt when the tenancy actually ended (move-out, rejection,
 *        closure). Defaults to now, which is right for every current caller.
 */
export function documentsExpiryFor(endedAt = new Date()) {
  const base = endedAt instanceof Date ? endedAt : new Date(endedAt);
  if (Number.isNaN(base.getTime())) return null;
  return new Date(base.getTime() + TENANCY_DOCUMENT_RETENTION_DAYS() * DAY_MS);
}

/**
 * Stamps the expiry onto a TenantRequest document in memory. The caller saves.
 *
 * Idempotent, and deliberately never *extends* an expiry already set: a
 * tenancy that ends twice (a move-out confirmed after a lease already lapsed)
 * should keep its earlier clock, not restart it.
 */
export function markDocumentsExpiring(request, endedAt = new Date()) {
  if (!request) return request;
  if (request.documentsExpireAt) return request;
  request.documentsExpireAt = documentsExpiryFor(endedAt);
  return request;
}

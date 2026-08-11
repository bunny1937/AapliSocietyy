/**
 * ============================================================================
 * AapliSociety RBAC — Tenant repository guards
 * ============================================================================
 * Multi-tenant safety net. The #1 cross-tenant bug is a query that forgets to
 * scope by societyId. These helpers make that mistake throw instead of leaking.
 *
 *   const bills = await tenantFind(Bill, ctx.societyId, { status: "Unpaid" });
 *   const bill  = await tenantFindById(Bill, ctx.societyId, id); // 404 -> null
 *
 * They also implement OWNERSHIP scoping for the member hat (Decision #3): a
 * member may only read/write rows they own. Pass { ownerField, ownerId } to
 * enforce it at the data layer regardless of what the client sends.
 * ============================================================================
 */

export function assertSocietyId(societyId) {
  if (!societyId || typeof societyId !== "string") {
    throw new Error(
      "TENANT_SCOPE_MISSING: societyId is required for this query",
    );
  }
  return societyId;
}

function scopedFilter(societyId, filter = {}, owner) {
  assertSocietyId(societyId);
  const f = { ...filter, societyId };
  if (owner?.ownerField && owner?.ownerId != null) {
    f[owner.ownerField] = owner.ownerId;
  }
  return f;
}

export async function tenantFind(
  Model,
  societyId,
  filter = {},
  { owner, ...opts } = {},
) {
  return Model.find(scopedFilter(societyId, filter, owner), null, opts);
}

export async function tenantFindOne(
  Model,
  societyId,
  filter = {},
  { owner } = {},
) {
  return Model.findOne(scopedFilter(societyId, filter, owner));
}

/**
 * Fetch by _id but ALSO require the row to belong to this tenant (and owner, if
 * given). A cross-tenant _id therefore resolves to null -> callers return 404,
 * never 403, so ids are not enumerable across societies.
 */
export async function tenantFindById(Model, societyId, id, { owner } = {}) {
  assertSocietyId(societyId);
  const filter = { _id: id, societyId };
  if (owner?.ownerField && owner?.ownerId != null)
    filter[owner.ownerField] = owner.ownerId;
  return Model.findOne(filter);
}

export async function tenantCount(
  Model,
  societyId,
  filter = {},
  { owner } = {},
) {
  return Model.countDocuments(scopedFilter(societyId, filter, owner));
}

export async function tenantUpdateOne(
  Model,
  societyId,
  filter,
  update,
  { owner } = {},
) {
  return Model.updateOne(scopedFilter(societyId, filter, owner), update);
}

export async function tenantDeleteOne(
  Model,
  societyId,
  filter,
  { owner } = {},
) {
  return Model.deleteOne(scopedFilter(societyId, filter, owner));
}

export default {
  assertSocietyId,
  tenantFind,
  tenantFindOne,
  tenantFindById,
  tenantCount,
  tenantUpdateOne,
  tenantDeleteOne,
};

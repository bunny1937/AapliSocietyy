import CommercialBillingHead from "@/models/CommercialBillingHead";
import { logAudit } from "@/lib/audit-logger";
import { COMMERCIAL_AUDIT_ACTIONS } from "./constants";
import { notFound } from "./errors";
import { withTransaction } from "./transactions";
import { buildPresetPayloads } from "./headPresets";

function toDto(doc) {
  const o = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return {
    id: String(o._id),
    headName: o.headName,
    categoryScope: o.categoryScope,
    calculationType: o.calculationType,
    rate: { Shop: o.rate?.Shop ?? null, Office: o.rate?.Office ?? null },
    isServiceCharge: !!o.isServiceCharge,
    nonOccupancyEligible: !!o.nonOccupancyEligible,
    // Per-unit applicability travels with the DTO because the billing engines
    // consume these DTOs, not the raw documents — leaving it out here was what
    // made every head apply to every shop.
    applicability: o.applicability || "All",
    quantityLabel: o.quantityLabel ?? null,
    optInKey: o.optInKey ?? null,
    sortOrder: o.sortOrder ?? 500,
    isActive: o.isActive !== false,
    updatedReason: o.updatedReason ?? null,
    updatedAt: o.updatedAt ?? null,
  };
}

export async function listCommercialHeadsForAdmin(societyId) {
  const rows = await CommercialBillingHead.find({ societyId, isDeleted: false })
    .sort({ headName: 1 })
    .lean();
  return rows.map(toDto);
}

// Used by the billing engine — active heads only.
export async function listActiveCommercialHeads(societyId) {
  const rows = await CommercialBillingHead.find({ societyId, isDeleted: false, isActive: true })
    .sort({ headName: 1 })
    .lean();
  return rows.map(toDto);
}

export async function createCommercialHead({ societyId, userId, input }) {
  return withTransaction(async (session) => {
    const [created] = await CommercialBillingHead.create(
      [
        {
          societyId,
          headName: input.headName,
          categoryScope: input.categoryScope,
          calculationType: input.calculationType,
          rate: input.rate,
          isServiceCharge: input.isServiceCharge ?? false,
          nonOccupancyEligible: input.nonOccupancyEligible ?? false,
          applicability: input.applicability ?? "All",
          quantityLabel: input.quantityLabel ?? null,
          optInKey: input.optInKey ?? null,
          sortOrder: input.sortOrder ?? 500,
          createdBy: userId,
          updatedBy: userId,
          updatedReason: "Commercial Billing Head Created",
        },
      ],
      session ? { session } : {},
    );
    await logAudit(userId, societyId, COMMERCIAL_AUDIT_ACTIONS.BILLING_HEAD_CREATED, null, {
      _id: created._id,
      headName: created.headName,
      categoryScope: created.categoryScope,
    });
    return toDto(created);
  });
}

export async function updateCommercialHead({ societyId, userId, headId, input }) {
  const existing = await CommercialBillingHead.findOne({ _id: headId, societyId, isDeleted: false });
  if (!existing) throw notFound();

  const before = {
    headName: existing.headName,
    rate: existing.rate?.toObject?.() ?? existing.rate,
    applicability: existing.applicability,
    isActive: existing.isActive,
  };
  for (const key of [
    "headName",
    "categoryScope",
    "calculationType",
    "rate",
    "isServiceCharge",
    "nonOccupancyEligible",
    "applicability",
    "quantityLabel",
    "isActive",
    // optInKey is deliberately NOT updatable: it is the stable identity every
    // shop's opt-in row points at, so letting it change would silently detach
    // every shop's choice for this head.
  ]) {
    if (input[key] !== undefined) existing[key] = input[key];
  }
  existing.updatedBy = userId;
  existing.updatedReason = "Commercial Billing Head Updated";

  return withTransaction(async (session) => {
    await existing.save(session ? { session } : {});
    await logAudit(userId, societyId, COMMERCIAL_AUDIT_ACTIONS.BILLING_HEAD_UPDATED, before, {
      _id: existing._id,
      headName: existing.headName,
      rate: existing.rate,
      applicability: existing.applicability,
      isActive: existing.isActive,
    });
    return toDto(existing);
  });
}

// Soft delete only — bills already generated keep their own charge snapshot,
// so removing a head from the rate card must never touch what was billed.
export async function deleteCommercialHead({ societyId, userId, headId, reason }) {
  const existing = await CommercialBillingHead.findOne({ _id: headId, societyId, isDeleted: false });
  if (!existing) throw notFound();

  existing.isDeleted = true;
  existing.deletedAt = new Date();
  existing.deletedBy = userId;
  existing.deleteReason = reason || null;
  existing.isActive = false;
  existing.updatedBy = userId;

  return withTransaction(async (session) => {
    await existing.save(session ? { session } : {});
    await logAudit(
      userId,
      societyId,
      COMMERCIAL_AUDIT_ACTIONS.BILLING_HEAD_DELETED,
      { headName: existing.headName, isActive: true },
      { _id: existing._id, headName: existing.headName, deleteReason: existing.deleteReason },
    );
    return { id: String(existing._id), deleted: true };
  });
}

// Order-only. The engine is order-independent (fixed + per-sq-ft first, then
// percentages on that base) — this only controls the order charges print in.
// Foreign IDs (wrong society, deleted) are silently skipped rather than
// failing the whole batch.
export async function reorderCommercialHeads({ societyId, userId, order }) {
  const owned = await CommercialBillingHead.find({
    _id: { $in: order.map((o) => o.id) },
    societyId,
    isDeleted: false,
  })
    .select("_id")
    .lean();
  const ownedIds = new Set(owned.map((o) => String(o._id)));

  const ops = order
    .filter((o) => ownedIds.has(String(o.id)))
    .map((o) => ({
      updateOne: {
        filter: { _id: o.id, societyId },
        update: { $set: { sortOrder: o.sortOrder, updatedBy: userId } },
      },
    }));
  if (ops.length) await CommercialBillingHead.bulkWrite(ops);

  await logAudit(userId, societyId, COMMERCIAL_AUDIT_ACTIONS.BILLING_HEAD_REORDERED, null, {
    order: order.map((o) => ({ id: o.id, sortOrder: o.sortOrder })),
  });
  return listCommercialHeadsForAdmin(societyId);
}

// Idempotent: a head already on the rate card (matched by headName) is never
// duplicated, so running this twice — or after the admin already added a few
// charges by hand — just fills in what is missing.
export async function seedCommercialHeads({ societyId, userId, scope, keys }) {
  const payloads = buildPresetPayloads(scope, keys);
  const existing = await CommercialBillingHead.find({ societyId, isDeleted: false })
    .select("headName")
    .lean();
  const existingNames = new Set(existing.map((h) => h.headName));
  const toCreate = payloads.filter((p) => !existingNames.has(p.headName));

  if (toCreate.length === 0) {
    return { created: 0, skipped: payloads.length, heads: await listCommercialHeadsForAdmin(societyId) };
  }

  return withTransaction(async (session) => {
    const docs = await CommercialBillingHead.create(
      toCreate.map((p) => ({
        societyId,
        headName: p.headName,
        categoryScope: p.categoryScope,
        calculationType: p.calculationType,
        rate: p.rate,
        isServiceCharge: p.isServiceCharge,
        nonOccupancyEligible: p.nonOccupancyEligible,
        applicability: p.applicability,
        quantityLabel: p.quantityLabel,
        optInKey: p.optInKey,
        sortOrder: p.sortOrder,
        notes: p.notes,
        createdBy: userId,
        updatedBy: userId,
        updatedReason: "Commercial Billing Head Created",
      })),
      session ? { session, ordered: true } : { ordered: true },
    );
    await logAudit(userId, societyId, COMMERCIAL_AUDIT_ACTIONS.BILLING_HEAD_SEEDED, null, {
      scope,
      created: docs.map((d) => d.headName),
    });
    return {
      created: docs.length,
      skipped: payloads.length - toCreate.length,
      heads: await listCommercialHeadsForAdmin(societyId),
    };
  });
}

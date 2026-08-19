import mongoose from "mongoose";
import BusinessProfile from "@/models/BusinessProfile";
import Member from "@/models/Member";
import { logAudit } from "@/lib/audit-logger";
import { isDuplicateKeyError } from "@/lib/mongoErrors";
import {
  COMMERCIAL_AUDIT_ACTIONS,
  COMMERCIAL_FLAT_TYPES,
  unitClassForMember,
  VISIBILITY_STATUS,
} from "./constants";
import { CommercialError, notFound } from "./errors";
import { isValidBusinessMediaKey } from "./media";
import { assertCategoryUsable } from "./categoryService";
import { toBusinessProfileDto } from "./dto";
import { withTransaction } from "./transactions";

const toObjectId = (id) =>
  id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id));

const EDITABLE_FIELDS = [
  "tradeName",
  "legalName",
  "description",
  "phone",
  "whatsapp",
  "email",
  "gstin",
  "licenseNumber",
  "businessHours",
  "fulfillmentModes",
];

// The unit must exist, belong to the caller's society, and be a Shop/Office.
// A residential member can therefore never acquire a business profile, even
// with a crafted memberId.
export async function assertCommercialMember(societyId, memberId) {
  const member = await Member.findOne({ _id: memberId, societyId })
    .select("_id flatType wing flatNo isDeleted")
    .lean();
  if (!member || member.isDeleted === true) throw notFound();
  if (!COMMERCIAL_FLAT_TYPES.includes(member.flatType)) {
    throw new CommercialError(
      400,
      "Only Shop or Office units can have a business profile",
      "NOT_A_COMMERCIAL_UNIT",
    );
  }
  return member;
}

function applyMedia(doc, input, societyId) {
  let changed = false;
  for (const kind of ["logo", "cover"]) {
    const field = `${kind}Key`;
    if (input[field] === undefined) continue;
    const value = input[field];
    if (value === null) {
      if (doc[field] !== null) changed = true;
      doc[field] = null;
      continue;
    }
    if (!isValidBusinessMediaKey(value, societyId, kind)) {
      throw new CommercialError(400, `Invalid ${kind} image reference`, "INVALID_MEDIA_KEY");
    }
    if (doc[field] !== value) changed = true;
    doc[field] = value;
  }
  if (changed) doc.mediaVersion = (doc.mediaVersion ?? 0) + 1;
  return changed;
}

export async function createBusinessProfile({ societyId, userId, input }) {
  await assertCommercialMember(societyId, input.memberId);
  await assertCategoryUsable(societyId, input.categoryId);

  // Idempotent by construction: the unique { societyId, memberId } index makes
  // a duplicate create fail with 409 instead of creating a second business.
  const existing = await BusinessProfile.findOne({ societyId, memberId: input.memberId })
    .select("_id isDeleted")
    .lean();
  if (existing) {
    throw new CommercialError(409, "This unit already has a business profile", "DUPLICATE_PROFILE");
  }

  const doc = new BusinessProfile({
    societyId,
    memberId: input.memberId,
    categoryId: input.categoryId,
    visibilityStatus: VISIBILITY_STATUS.DRAFT,
    createdBy: userId,
    updatedBy: userId,
    updatedReason: "Profile Created",
  });
  for (const field of EDITABLE_FIELDS) {
    if (input[field] !== undefined) doc[field] = input[field];
  }
  applyMedia(doc, input, societyId);

  return withTransaction(async (session) => {
    try {
      await doc.save(session ? { session } : {});
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new CommercialError(409, "This unit already has a business profile", "DUPLICATE_PROFILE");
      }
      throw err;
    }
    await logAudit(userId, societyId, COMMERCIAL_AUDIT_ACTIONS.PROFILE_CREATED, null, {
      _id: doc._id,
      memberId: doc.memberId,
      tradeName: doc.tradeName,
    });
    return toBusinessProfileDto(doc.toObject());
  });
}

export async function loadOwnedProfile({ societyId, memberId }) {
  const doc = await BusinessProfile.findOne({ societyId, memberId, isDeleted: { $ne: true } }).lean();
  return doc ? toBusinessProfileDto(doc) : null;
}

export async function loadProfileForAdmin({ societyId, id }) {
  const doc = await BusinessProfile.findOne({ _id: id, societyId, isDeleted: { $ne: true } }).lean();
  if (!doc) throw notFound();
  return doc;
}

function reasonFor(input, mediaChanged) {
  if (input.updatedReason) return input.updatedReason;
  if (mediaChanged) return "Logo Updated";
  if (input.gstin !== undefined) return "GST Updated";
  if (input.categoryId !== undefined) return "Category Changed";
  if (input.businessHours !== undefined) return "Business Hours Updated";
  return "Business Details Updated";
}

/**
 * Shared update path for BOTH the admin route and the owner's /v1 route, so
 * the two surfaces cannot drift. `scope` restricts what may be written.
 */
export async function updateBusinessProfile({ societyId, userId, id, memberId, input }) {
  const query = { societyId, isDeleted: { $ne: true } };
  if (id) query._id = id;
  if (memberId) query.memberId = memberId;
  const doc = await BusinessProfile.findOne(query);
  if (!doc) throw notFound();

  // Optimistic concurrency — a stale editor is told to reload instead of
  // silently overwriting someone else's edit.
  if (input.expectedUpdatedAt) {
    const current = new Date(doc.updatedAt).toISOString();
    if (current !== new Date(input.expectedUpdatedAt).toISOString()) {
      throw new CommercialError(409, "This business profile changed while you were editing it. Reload and try again.", "STALE_WRITE");
    }
  }

  if (input.categoryId !== undefined) {
    await assertCategoryUsable(societyId, input.categoryId);
    doc.categoryId = input.categoryId;
  }
  const before = {};
  for (const field of EDITABLE_FIELDS) {
    if (input[field] === undefined) continue;
    before[field] = doc[field];
    doc[field] = input[field];
  }
  const mediaChanged = applyMedia(doc, input, societyId);
  doc.updatedBy = userId;
  doc.updatedReason = reasonFor(input, mediaChanged);

  return withTransaction(async (session) => {
    await doc.save(session ? { session } : {});
    await logAudit(userId, societyId, COMMERCIAL_AUDIT_ACTIONS.PROFILE_UPDATED, before, {
      _id: doc._id,
      updatedReason: doc.updatedReason,
      tradeName: doc.tradeName,
    });
    return toBusinessProfileDto(doc.toObject());
  });
}

// Admin-only, intentionally NOT part of EDITABLE_FIELDS/businessProfileUpdateSchema
// (those are shared with the owner self-service PATCH /v1/commercial/me route).
// Whether a rented-out unit is charged the non-occupancy line is a billing
// decision — never owner-editable. See lib/commercial/commercialChargeEngine.js.
export async function setNonOccupancyCharged({ societyId, userId, id, value }) {
  const doc = await BusinessProfile.findOne({ _id: id, societyId, isDeleted: { $ne: true } });
  if (!doc) throw notFound();
  const before = { nonOccupancyCharged: doc.nonOccupancyCharged };
  doc.nonOccupancyCharged = value === true;
  doc.updatedBy = userId;
  doc.updatedReason = "Business Details Updated";
  return withTransaction(async (session) => {
    await doc.save(session ? { session } : {});
    await logAudit(userId, societyId, COMMERCIAL_AUDIT_ACTIONS.PROFILE_UPDATED, before, {
      _id: doc._id,
      nonOccupancyCharged: doc.nonOccupancyCharged,
    });
    return toBusinessProfileDto(doc.toObject());
  });
}

const TRANSITIONS = {
  publish: {
    to: VISIBILITY_STATUS.PUBLISHED,
    reason: "Published",
    action: COMMERCIAL_AUDIT_ACTIONS.PROFILE_PUBLISHED,
  },
  suspend: {
    to: VISIBILITY_STATUS.SUSPENDED,
    reason: "Suspended",
    action: COMMERCIAL_AUDIT_ACTIONS.PROFILE_SUSPENDED,
  },
  reactivate: {
    to: VISIBILITY_STATUS.PUBLISHED,
    reason: "Reactivated",
    action: COMMERCIAL_AUDIT_ACTIONS.PROFILE_REACTIVATED,
  },
};

/**
 * Idempotent state transition: repeating publish on an already-published
 * profile succeeds and writes NO duplicate audit event.
 */
export async function transitionBusinessProfile({ societyId, userId, id, command }) {
  const spec = TRANSITIONS[command];
  if (!spec) throw new CommercialError(400, "Unknown command", "UNKNOWN_COMMAND");

  const doc = await BusinessProfile.findOne({ _id: id, societyId, isDeleted: { $ne: true } });
  if (!doc) throw notFound();

  if (doc.visibilityStatus === spec.to) {
    return { profile: toBusinessProfileDto(doc.toObject()), changed: false };
  }
  if (command === "publish" && (!doc.tradeName || !doc.categoryId)) {
    throw new CommercialError(400, "Add a trade name and category before publishing", "INCOMPLETE_PROFILE");
  }

  const from = doc.visibilityStatus;
  doc.visibilityStatus = spec.to;
  doc.updatedBy = userId;
  doc.updatedReason = spec.reason;

  return withTransaction(async (session) => {
    await doc.save(session ? { session } : {});
    await logAudit(userId, societyId, spec.action, { visibilityStatus: from }, {
      _id: doc._id,
      visibilityStatus: doc.visibilityStatus,
    });
    return { profile: toBusinessProfileDto(doc.toObject()), changed: true };
  });
}

export async function listProfilesForAdmin({ societyId, status, search, cursor, limit = 25 }) {
  const filter = { societyId, isDeleted: { $ne: true } };
  if (status) filter.visibilityStatus = status;
  if (cursor) filter._id = { $lt: cursor };
  if (typeof search === "string" && search.trim().length >= 2) {
    filter.tradeName = {
      $regex: search.trim().slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      $options: "i",
    };
  }
  const pageSize = Math.min(Number(limit) || 25, 50);
  const rows = await BusinessProfile.find(filter)
    .select("tradeName categoryId memberId visibilityStatus updatedAt updatedReason logoKey mediaVersion")
    .sort({ _id: -1 })
    .limit(pageSize + 1)
    .lean();
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const members = await Member.find({
    _id: { $in: page.map((r) => r.memberId) },
    societyId,
  })
    .select("wing flatNo flatType ownerName")
    .lean();
  const byId = new Map(members.map((m) => [String(m._id), m]));
  return {
    profiles: page.map((r) => {
      const m = byId.get(String(r.memberId));
      return {
        id: String(r._id),
        tradeName: r.tradeName,
        categoryId: r.categoryId ? String(r.categoryId) : null,
        memberId: String(r.memberId),
        visibilityStatus: r.visibilityStatus,
        updatedAt: r.updatedAt,
        updatedReason: r.updatedReason ?? null,
        unit: m
          ? { wing: m.wing ?? null, flatNo: m.flatNo ?? null, flatType: m.flatType ?? null, ownerName: m.ownerName ?? null }
          : null,
      };
    }),
    nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
  };
}

// Units that may still be given a business profile (admin picker).
export async function listCommercialUnits({ societyId }) {
  const [members, taken] = await Promise.all([
    Member.find({ societyId, flatType: { $in: COMMERCIAL_FLAT_TYPES }, isDeleted: { $ne: true } })
      .select("wing flatNo flatType ownerName")
      .sort({ wing: 1, flatNo: 1 })
      .limit(500)
      .lean(),
    BusinessProfile.find({ societyId, isDeleted: { $ne: true } }).select("memberId").lean(),
  ]);
  const used = new Set(taken.map((t) => String(t.memberId)));
  return members.map((m) => ({
    memberId: String(m._id),
    wing: m.wing ?? null,
    flatNo: m.flatNo ?? null,
    flatType: m.flatType,
    ownerName: m.ownerName ?? null,
    hasBusinessProfile: used.has(String(m._id)),
  }));
}

// Every unit in the society, commercial or not, so an admin can see what is
// there and tag the shops. Without this the unit picker looks "broken" on a
// society whose members were all imported as residential flat types.
export async function listAllUnits({ societyId, search, onlyCommercial = false }) {
  const filter = { societyId, isDeleted: { $ne: true } };
  if (onlyCommercial) filter.flatType = { $in: COMMERCIAL_FLAT_TYPES };
  if (search && String(search).trim()) {
    const rx = new RegExp(String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ flatNo: rx }, { wing: rx }, { ownerName: rx }];
  }
  const [members, taken] = await Promise.all([
    Member.find(filter)
      .select("wing flatNo flatType ownerName")
      .sort({ wing: 1, flatNo: 1 })
      .limit(1000)
      .lean(),
    BusinessProfile.find({ societyId, isDeleted: { $ne: true } }).select("memberId tradeName").lean(),
  ]);
  const byMember = new Map(taken.map((t) => [String(t.memberId), t]));
  return members.map((m) => {
    const profile = byMember.get(String(m._id));
    return {
      memberId: String(m._id),
      wing: m.wing ?? null,
      flatNo: m.flatNo ?? null,
      flatType: m.flatType ?? null,
      unitClass: unitClassForMember(m),
      ownerName: m.ownerName ?? null,
      isCommercial: COMMERCIAL_FLAT_TYPES.includes(m.flatType),
      hasBusinessProfile: Boolean(profile),
      businessName: profile?.tradeName ?? null,
    };
  });
}

// Tags an existing unit as Shop/Office (or back to a residential type) by
// writing the EXISTING Member.flatType field with an EXISTING enum value.
// No new field, no migration - this is the same value an admin can already
// set from the member screen, exposed where the commercial admin needs it.
export async function classifyUnit({ societyId, userId, memberId, flatType }) {
  const member = await Member.findOne({ _id: memberId, societyId, isDeleted: { $ne: true } })
    .select("_id wing flatNo flatType ownerName")
    .lean();
  if (!member) throw notFound();
  if (member.flatType === flatType) {
    return { memberId: String(member._id), flatType, changed: false };
  }

  // Never orphan a live listing by demoting its unit back to residential.
  if (!COMMERCIAL_FLAT_TYPES.includes(flatType)) {
    const profile = await BusinessProfile.findOne({
      societyId,
      memberId,
      isDeleted: { $ne: true },
    })
      .select("_id")
      .lean();
    if (profile) {
      throw new CommercialError(
        400,
        "This unit has a business listing. Delete the listing before making it residential again.",
        "UNIT_HAS_PROFILE",
      );
    }
  }

  await Member.updateOne({ _id: memberId, societyId }, { $set: { flatType } });
  await logAudit(
    userId,
    societyId,
    COMMERCIAL_AUDIT_ACTIONS.UNIT_CLASSIFIED,
    { memberId: String(memberId), flatType: member.flatType ?? null },
    { memberId: String(memberId), flatType },
  );
  return { memberId: String(member._id), flatType, changed: true };
}

// Tag many units in one action. 84 flats one dropdown at a time is not a
// workflow. Each unit still goes through classifyUnit, so the same guard rails
// and the same audit entry apply to every row.
export async function bulkClassifyUnits({ societyId, userId, memberIds, flatType }) {
  const ids = [...new Set((memberIds || []).map(String))];
  const changed = [];
  const skipped = [];
  for (const memberId of ids) {
    try {
      const res = await classifyUnit({ societyId, userId, memberId, flatType });
      if (res.changed) changed.push(memberId);
      else skipped.push({ memberId, reason: "Already this type" });
    } catch (err) {
      skipped.push({ memberId, reason: err?.message || "Could not update" });
    }
  }
  return { requested: ids.length, changedCount: changed.length, changed, skipped };
}

// Numbers for the Commercial overview screen.
export async function getCommercialOverview({ societyId }) {
  const [unitRows, profileRows] = await Promise.all([
    Member.aggregate([
      { $match: { societyId: toObjectId(societyId), isDeleted: { $ne: true } } },
      { $group: { _id: "$flatType", count: { $sum: 1 } } },
    ]),
    BusinessProfile.aggregate([
      { $match: { societyId: toObjectId(societyId), isDeleted: { $ne: true } } },
      { $group: { _id: "$visibilityStatus", count: { $sum: 1 } } },
    ]),
  ]);
  const byFlatType = {};
  let totalUnits = 0;
  let commercialUnits = 0;
  for (const row of unitRows) {
    const key = row._id ?? "Unspecified";
    byFlatType[key] = row.count;
    totalUnits += row.count;
    if (COMMERCIAL_FLAT_TYPES.includes(row._id)) commercialUnits += row.count;
  }
  const listings = { DRAFT: 0, PUBLISHED: 0, SUSPENDED: 0 };
  let totalListings = 0;
  for (const row of profileRows) {
    if (row._id in listings) listings[row._id] = row.count;
    totalListings += row.count;
  }
  return {
    units: { total: totalUnits, commercial: commercialUnits, byFlatType },
    listings: { total: totalListings, ...listings },
    unitsWithoutListing: Math.max(commercialUnits - totalListings, 0),
  };
}

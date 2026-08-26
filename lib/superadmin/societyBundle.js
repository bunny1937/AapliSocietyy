import Society from "@/models/Society";
import User from "@/models/User";
import { SOCIETY_COLLECTIONS, VERIFIED_COLLECTIONS } from "./societyCollections";
import { redactDoc, redactDocs, REDACTION_NOTICE } from "./societyRedaction";


// LOOP-05: the export/verify/restore/delete-permanently flow all operate on
// the SOCIETY_COLLECTIONS registry — every model carrying a societyId, not
// just the seven delete-society happens to name. A society's notices,
// complaints, ledger/journal lines, amenities, shops, vouchers etc. are as
// unrecoverable as its bills once a permanent delete runs, so the snapshot
// covers them all.
//
// v2: registry-wide collection set + canonical (BSON-lossless) value
// comparison. v1 bundles are still restorable, but can't be verified against
// live state (they only carried 7 collections).
// v3: export redaction (Aadhaar dropped, PAN masked, password hashes
// dropped). A v2 file still carries the unredacted values, so verifying one
// against now-redacted live state would mismatch on exactly those fields —
// hence the bump, which forces a fresh download rather than a confusing
// diff. Older bundles stay restorable.
export const BUNDLE_FORMAT_VERSION = 3;

// Fields that move on their own between download and verify — comparing them
// would make a clean verify impossible.
const IGNORED_FIELDS = new Set(["__v", "updatedAt"]);

// User isn't queried by societyId alone (root-society accounts only — same
// rule delete-society applies), plus embedded profiles[] on OTHER users that
// merely reference this society (multi-society accounts) — captured
// separately so restore can reconstruct both halves correctly.
async function loadUsers(societyId) {
  const rootUsers = await User.find({ societyId }).lean();
  const profileUsers = await User.find({
    societyId: { $ne: societyId },
    "profiles.societyId": societyId,
  })
    .select("_id profiles")
    .lean();
  return { rootUsers, profileUsers };
}

export async function buildSocietyExportBundle(societyId) {
  const society = await Society.findById(societyId).lean();
  if (!society) return null;

  // Never ship the reversible plaintext credential in a downloadable file,
  // independent of whether it's still stored in the DB (SEC-02).
  if (society.credentials) delete society.credentials.plainPassword;

  const collections = {};
  for (const { key, Model } of SOCIETY_COLLECTIONS) {
    let docs = [];
    try {
      docs = await Model.find({ societyId }).lean();
    } catch (err) {
      // A model whose societyId is typed differently (or a collection that
      // doesn't exist yet) must not take the whole export down.
      console.warn(`societyBundle: skipping ${key} —`, err.message);
      continue;
    }
    // Only collections that actually hold data land in the bundle, so the
    // file (and the Excel workbook built from it) has one entry per real
    // collection rather than 75 empty ones.
    if (docs.length) collections[key] = redactDocs(docs);
  }
  const { rootUsers, profileUsers } = await loadUsers(societyId);
  if (rootUsers.length) collections.users = redactDocs(rootUsers);
  if (profileUsers.length) {
    collections.userProfileRefs = profileUsers.map((u) => ({
      userId: u._id,
      profiles: redactDocs((u.profiles || []).filter((p) => String(p.societyId) === String(societyId))),
    }));
  }

  return {
    formatVersion: BUNDLE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    societyId: String(societyId),
    // Redaction runs on both the live and the uploaded side of verification
    // (both are built by this function), so redacted fields never register as
    // mismatches. See lib/superadmin/societyRedaction.js.
    redactions: REDACTION_NOTICE,
    society: redactDoc(society),
    collections,
  };
}

// A refusal that happens before any comparison can run (wrong file, wrong
// society, society already gone). Still shaped like a full result so the UI
// renders one report component, never two.
function fatal(field, expected, actual, note) {
  return {
    ok: false,
    mismatchCount: 1,
    mismatches: [{ collection: "_root", id: null, field, expected, actual }],
    report: { sections: [], totals: { collections: 0, documents: 0, fields: 0, mismatches: 1 }, note },
  };
}

// Field-by-field comparison against current DB state. Returns every mismatch
// found AND a full per-collection account of what was compared — the delete
// wizard shows both, so "verified" means something an admin can actually
// read (7 collections, 412 documents, 6,038 fields, 0 differences) instead of
// a bare green tick.
export async function verifySocietyBundle(bundle, societyId) {
  const mismatches = [];
  if (!bundle || bundle.formatVersion !== BUNDLE_FORMAT_VERSION) {
    return fatal(
      "formatVersion",
      BUNDLE_FORMAT_VERSION,
      bundle?.formatVersion ?? null,
      "This file was produced by an older version of the exporter. Download a fresh export and upload that.",
    );
  }
  if (String(bundle.societyId) !== String(societyId)) {
    return fatal("societyId", String(societyId), String(bundle.societyId), "This export belongs to a different society.");
  }

  const current = await buildSocietyExportBundle(societyId);
  if (!current) return fatal("society", "exists", "not found", "The society no longer exists in the database.");

  // One report row per thing compared. status: "ok" | "mismatch" | "empty".
  const sections = [];

  const compareDocSets = (collectionKey, label, uploaded, live) => {
    const before = mismatches.length;
    let fieldsCompared = 0;
    const liveById = new Map(live.map((d) => [String(d._id), d]));
    const uploadedById = new Map(uploaded.map((d) => [String(d._id), d]));
    for (const [id, liveDoc] of liveById) {
      const upDoc = uploadedById.get(id);
      if (!upDoc) {
        mismatches.push({ collection: collectionKey, label, id, field: "_id", expected: "present in upload", actual: "missing from upload" });
        continue;
      }
      for (const field of Object.keys(liveDoc)) {
        if (IGNORED_FIELDS.has(field)) continue;
        fieldsCompared++;
        const a = canonical(liveDoc[field]);
        const b = canonical(upDoc[field]);
        if (a !== b) {
          mismatches.push({ collection: collectionKey, label, id, field, expected: a, actual: b });
        }
      }
    }
    for (const id of uploadedById.keys()) {
      if (!liveById.has(id)) {
        mismatches.push({ collection: collectionKey, label, id, field: "_id", expected: "absent (deleted since export)", actual: "present in upload" });
      }
    }
    const failed = mismatches.length - before;
    // Collections neither side has are reported as "empty" rather than a
    // green tick — nothing was actually checked there.
    const status = failed > 0 ? "mismatch" : live.length || uploaded.length ? "ok" : "empty";
    sections.push({
      key: collectionKey,
      label,
      inFile: uploaded.length,
      inDatabase: live.length,
      fieldsCompared,
      mismatches: failed,
      status,
    });
  };

  // The society document itself — compared as a one-document set, so a
  // renamed society or an edited billing config can't slip past.
  compareDocSets("society", "Society record", bundle.society ? [bundle.society] : [], [current.society]);

  for (const { key, label } of VERIFIED_COLLECTIONS) {
    compareDocSets(key, label, bundle.collections?.[key] || [], current.collections[key] || []);
  }
  compareDocSets("users", "User account", bundle.collections?.users || [], current.collections.users || []);

  // Exported but deliberately not compared — logs, notifications and
  // analytics rollups write themselves between the download and this upload,
  // so comparing them would make a clean verify impossible. Listed anyway:
  // "not checked" is a fact the admin should see, not one to hide.
  const skipped = SOCIETY_COLLECTIONS.filter((c) => c.volatile)
    .map(({ key, label }) => ({
      key,
      label,
      inFile: (bundle.collections?.[key] || []).length,
      inDatabase: (current.collections[key] || []).length,
      fieldsCompared: 0,
      mismatches: 0,
      status: "skipped",
    }))
    .filter((s) => s.inFile || s.inDatabase);

  const checked = sections.filter((s) => s.status !== "empty");
  const totals = {
    collections: checked.length,
    documents: checked.reduce((n, s) => n + s.inDatabase, 0),
    fields: sections.reduce((n, s) => n + s.fieldsCompared, 0),
    mismatches: mismatches.length,
    skippedCollections: skipped.length,
    skippedDocuments: skipped.reduce((n, s) => n + s.inDatabase, 0),
  };

  return {
    ok: mismatches.length === 0,
    mismatchCount: mismatches.length,
    mismatches: mismatches.slice(0, 500),
    report: { sections, skipped, totals, exportedAt: bundle.exportedAt, verifiedAt: new Date().toISOString() },
  };
}

// Canonical string form of a value, identical whether it came straight out of
// Mongo (ObjectId / Date / Buffer / Decimal128 instances) or out of the
// downloaded JSON file (hex strings / ISO strings). Without this, every _id
// and every date reads as a mismatch — a live ObjectId JSON-stringifies to
// {"buffer":{"0":106,...}} and a nested Date to {}, neither of which can ever
// equal what the file round-tripped through JSON.parse.
export function canonical(v) {
  return JSON.stringify(toPlain(v)) ?? "null";
}

function toPlain(v) {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return v.toString();
  if (typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(toPlain);

  // ObjectId, Decimal128, Long, Binary — anything BSON hands back that has a
  // meaningful string form. ObjectId hex is what the JSON file carries, so
  // both sides land on the same 24-char string.
  if (typeof v._bsontype === "string" || isObjectIdLike(v)) return String(v);
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(v)) return v.toString("base64");
  if (v instanceof Map) return toPlain(Object.fromEntries(v));

  // Plain object: sort keys so two structurally equal objects stringify
  // identically regardless of insertion order.
  return Object.keys(v)
    .sort()
    .reduce((acc, k) => {
      acc[k] = toPlain(v[k]);
      return acc;
    }, {});
}

// An ObjectId that arrived without its _bsontype tag (some lean() paths,
// older driver shapes).
function isObjectIdLike(v) {
  return (
    v?.constructor?.name === "ObjectId" ||
    (typeof v?.toHexString === "function" && typeof v?.id !== "undefined")
  );
}

// Recreates a society and every collection in the bundle with their ORIGINAL
// _ids. Refuses if a society with that id already exists — restore is for
// bringing back a previously (soft- or hard-) deleted society, not merging
// into a live one.
export async function restoreSocietyFromBundle(bundle) {
  if (!bundle || ![1, 2, BUNDLE_FORMAT_VERSION].includes(bundle.formatVersion)) {
    throw new Error("Unrecognized or incompatible export format");
  }
  const existing = await Society.findById(bundle.societyId).lean();
  if (existing) throw new Error("A society with this id already exists — cannot restore over a live society");

  await Society.create({ ...bundle.society, isDeleted: false, deletedAt: undefined, purgeScheduledFor: undefined, lifecycleStatus: "Active" });

  const counts = {};
  for (const { key, Model } of SOCIETY_COLLECTIONS) {
    const docs = bundle.collections?.[key] || [];
    if (!docs.length) continue;
    await Model.insertMany(docs, { ordered: false });
    counts[key] = docs.length;
  }
  const users = bundle.collections?.users || [];
  if (users.length) {
    await User.insertMany(users, { ordered: false });
    counts.users = users.length;
  }

  // Re-attach the society back into any OTHER user's profiles[] that
  // referenced it (multi-society accounts) — these users were never deleted,
  // only $pull'd, so upsert the profile entries back in.
  for (const ref of bundle.collections?.userProfileRefs || []) {
    for (const profile of ref.profiles || []) {
      await User.updateOne(
        { _id: ref.userId, "profiles.profileId": { $ne: profile.profileId } },
        { $push: { profiles: profile } },
      );
    }
  }

  return { restored: true, societyId: bundle.societyId, counts };
}

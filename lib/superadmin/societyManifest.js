import { createHmac, randomBytes } from "node:crypto";
import { canonical } from "./societyBundle";
import { SOCIETY_COLLECTIONS } from "./societyCollections";

// The manifest: an account of what an export contained, holding no personal
// data — counts, field *names*, and hashes. Safe to retain after the payload
// is gone, which is the whole point (docs/society-offboarding-overview.md §3.2).
//
// ## Why HMAC and not SHA-256
//
// A bare hash of a low-entropy value is reversible by brute force.
// sha256("9769121824") recovers that phone number in seconds — there are only
// 10^10 candidates. If leaves were bare hashes, a leaked manifest would be a
// re-identification oracle and the "no personal data retained" claim would be
// false.
//
// Every leaf is therefore HMAC'd with a 32-byte salt generated per export and
// stored alongside the manifest. An attacker holding the manifest alone cannot
// brute force anything; an attacker holding manifest AND salt has to brute
// force each field independently against a keyed function, and if they already
// have our database they had the values anyway.
//
// ## Granularity is bounded on purpose
//
// Storing one leaf per field is exact but unbounded — a society with 200k
// bills would blow past MongoDB's 16MB document limit. So each collection gets
// the finest granularity that fits its size, and records which one it got, so
// the UI can state honestly how precise a drift report will be rather than
// implying field-level precision it cannot deliver.
//
//   field      → names the exact field that changed
//   document   → names the document; the confirmer diffs it against their file
//   collection → says only that the collection changed
export const MANIFEST_VERSION = 1;

const FIELD_GRANULARITY_MAX_DOCS = 500;
const DOCUMENT_GRANULARITY_MAX_DOCS = 5000;

// Field leaves are truncated to 64 bits. They exist to detect change, not to
// resist forgery — the collection and bundle roots are full-length and are
// what a tamper check actually rests on. At 64 bits a collision needs ~2^32
// fields before it becomes likely; a large society has ~10^5.
const LEAF_HEX = 16;
const IGNORED_FIELDS = new Set(["__v", "updatedAt"]);

export function newSalt() {
  return randomBytes(32).toString("hex");
}

const hmac = (salt, input, hexLength) => {
  const digest = createHmac("sha256", Buffer.from(salt, "hex")).update(input).digest("hex");
  return hexLength ? digest.slice(0, hexLength) : digest;
};

// Roll a sorted list of [name, hash] pairs into one hash. Sorting makes the
// result independent of document/key order, so a re-read of the same data
// always produces the same root.
const rollup = (salt, pairs) =>
  hmac(salt, pairs.slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, v]) => `${k}:${v}`).join("\n"));

const LABELS = Object.fromEntries(SOCIETY_COLLECTIONS.map((c) => [c.key, c.label]));

function summariseCollection(salt, key, docs) {
  const granularity =
    docs.length <= FIELD_GRANULARITY_MAX_DOCS
      ? "field"
      : docs.length <= DOCUMENT_GRANULARITY_MAX_DOCS
        ? "document"
        : "collection";

  const fieldNames = new Set();
  const docPairs = [];
  const documents = {}; // docId -> { root, fields? }
  let fieldCount = 0;

  for (const doc of docs) {
    const id = String(doc._id);
    const fieldPairs = [];
    for (const field of Object.keys(doc)) {
      if (IGNORED_FIELDS.has(field)) continue;
      fieldNames.add(field);
      fieldCount++;
      fieldPairs.push([field, hmac(salt, `${key}|${id}|${field}|${canonical(doc[field])}`, LEAF_HEX)]);
    }
    const docRoot = rollup(salt, fieldPairs);
    docPairs.push([id, docRoot]);
    if (granularity === "field") {
      documents[id] = { root: docRoot, fields: Object.fromEntries(fieldPairs) };
    } else if (granularity === "document") {
      documents[id] = { root: docRoot };
    }
  }

  return {
    label: LABELS[key] || key,
    granularity,
    docs: docs.length,
    fields: fieldCount,
    // Field NAMES are schema, not data — they let us detect a shape change
    // ("a column vanished") that counts alone would miss.
    fieldNames: [...fieldNames].sort(),
    root: rollup(salt, docPairs),
    documents,
  };
}

/**
 * @param bundle a bundle from buildSocietyExportBundle (already redacted)
 * @param salt   hex string from newSalt(); store it with the manifest
 */
export function buildManifest(bundle, salt) {
  const collections = {};
  const rootPairs = [];
  let documents = 0;
  let fields = 0;

  for (const [key, docs] of Object.entries(bundle.collections || {})) {
    // userProfileRefs are not documents with _ids; they're reconstruction
    // hints for other societies' users. Counted, not hashed per-document.
    if (key === "userProfileRefs") continue;
    const summary = summariseCollection(salt, key, docs);
    collections[key] = summary;
    rootPairs.push([key, summary.root]);
    documents += summary.docs;
    fields += summary.fields;
  }

  // The society document itself, as a one-document collection — a renamed
  // society or an edited billing config has to move the root.
  if (bundle.society) {
    const summary = summariseCollection(salt, "society", [bundle.society]);
    summary.label = "Society record";
    collections.society = summary;
    rootPairs.push(["society", summary.root]);
    documents += 1;
    fields += summary.fields;
  }

  return {
    manifestVersion: MANIFEST_VERSION,
    algorithm: "hmac-sha256",
    formatVersion: bundle.formatVersion,
    societyId: bundle.societyId,
    exportedAt: bundle.exportedAt,
    root: rollup(salt, rootPairs),
    counts: { collections: Object.keys(collections).length, documents, fields },
    collections,
  };
}

/**
 * Compare a stored manifest against one rebuilt from live data.
 * Returns the same shape the delete wizard's VerifyReport already renders.
 *
 * `stored` and `live` MUST have been built with the same salt, or everything
 * differs.
 */
export function diffManifests(stored, live) {
  const sections = [];
  const changes = [];
  const keys = new Set([...Object.keys(stored?.collections || {}), ...Object.keys(live?.collections || {})]);

  for (const key of [...keys].sort()) {
    const a = stored?.collections?.[key];
    const b = live?.collections?.[key];
    const label = b?.label || a?.label || key;
    const before = changes.length;

    if (!a) {
      changes.push({ collection: key, label, id: null, field: null, status: "collection-added" });
    } else if (!b) {
      changes.push({ collection: key, label, id: null, field: null, status: "collection-removed" });
    } else if (a.root !== b.root) {
      // Roots differ — drill down as far as the stored granularity allows.
      const addedNames = b.fieldNames.filter((n) => !a.fieldNames.includes(n));
      const removedNames = a.fieldNames.filter((n) => !b.fieldNames.includes(n));
      for (const n of addedNames) changes.push({ collection: key, label, id: null, field: n, status: "field-name-added" });
      for (const n of removedNames) changes.push({ collection: key, label, id: null, field: n, status: "field-name-removed" });

      const granularity = a.granularity === "field" && b.granularity === "field" ? "field" : a.granularity;
      if (granularity === "collection") {
        changes.push({ collection: key, label, id: null, field: null, status: "changed" });
      } else {
        const ids = new Set([...Object.keys(a.documents || {}), ...Object.keys(b.documents || {})]);
        for (const id of ids) {
          const da = a.documents?.[id];
          const db = b.documents?.[id];
          if (!da) { changes.push({ collection: key, label, id, field: null, status: "document-added" }); continue; }
          if (!db) { changes.push({ collection: key, label, id, field: null, status: "document-removed" }); continue; }
          if (da.root === db.root) continue;
          if (granularity !== "field") {
            changes.push({ collection: key, label, id, field: null, status: "document-changed" });
            continue;
          }
          const fieldKeys = new Set([...Object.keys(da.fields || {}), ...Object.keys(db.fields || {})]);
          for (const f of fieldKeys) {
            const fa = da.fields?.[f];
            const fb = db.fields?.[f];
            if (fa === fb) continue;
            changes.push({
              collection: key,
              label,
              id,
              field: f,
              status: fa === undefined ? "field-added" : fb === undefined ? "field-removed" : "changed",
            });
          }
        }
      }
    }

    const mismatches = changes.length - before;
    sections.push({
      key,
      label,
      granularity: b?.granularity || a?.granularity || "collection",
      inFile: a?.docs || 0,
      inDatabase: b?.docs || 0,
      fieldsCompared: b?.fields || a?.fields || 0,
      mismatches,
      status: mismatches > 0 ? "mismatch" : (a?.docs || b?.docs) ? "ok" : "empty",
    });
  }

  const checked = sections.filter((s) => s.status !== "empty");
  return {
    ok: changes.length === 0,
    mismatchCount: changes.length,
    changes: changes.slice(0, 500),
    sections,
    totals: {
      collections: checked.length,
      documents: checked.reduce((n, s) => n + s.inDatabase, 0),
      fields: sections.reduce((n, s) => n + s.fieldsCompared, 0),
      mismatches: changes.length,
    },
  };
}

// The part of a manifest safe to print in a file or an email: no leaves, no
// per-document hashes — just the shape and the roots.
export function manifestSummary(manifest) {
  return {
    manifestVersion: manifest.manifestVersion,
    algorithm: manifest.algorithm,
    root: manifest.root,
    exportedAt: manifest.exportedAt,
    counts: manifest.counts,
    collections: Object.fromEntries(
      Object.entries(manifest.collections).map(([k, c]) => [
        k,
        { label: c.label, docs: c.docs, fields: c.fields, granularity: c.granularity, root: c.root },
      ]),
    ),
  };
}

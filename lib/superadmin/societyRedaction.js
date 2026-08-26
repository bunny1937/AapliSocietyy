// Export redaction — what never leaves the database, in any artifact.
//
// Applied inside buildSocietyExportBundle, so the JSON bundle, the Excel
// workbook, BOTH SIDES of verification, and restore all see the same redacted
// view. That consistency is deliberate: if redaction happened at the file
// boundary instead, the live-vs-uploaded comparison would flag every redacted
// field as a mismatch on every single verify.
//
// ## Why field NAME and not field path
//
// `aadhaar` and `panCard` appear at three different depths on Member alone
// (top level, ownerHistory[], tenantHistory[]/currentTenant), and any new
// model is free to add a fourth. A path list has to be maintained and will
// silently fall behind; a name list is fail-safe — a new `aadhaar` field
// anywhere in any collection is redacted the day it is added, with no change
// here.
//
// ## Consequence for restore
//
// A restored bundle CANNOT bring these fields back — they were never in the
// file. Aadhaar is gone for good and PAN comes back masked. This is accepted:
// restore-from-file is disaster recovery, and the primary restore path is the
// grace window, which restores live data in place and loses nothing. See
// docs/society-offboarding-overview.md §3.1.

// drop  — key removed entirely, as if the field never existed
// mask4 — all but the last 4 characters replaced, so a human can still
//         eyeball-match a record without the value being usable
export const REDACTIONS = {
  // Aadhaar Act s.29 + the Sharing of Information Regulations restrict
  // sharing Aadhaar numbers, with penal consequences attached. A number in a
  // spreadsheet on somebody's laptop is the exact thing those provisions are
  // about, so it does not go into an export at all — not masked, not
  // truncated, not present.
  aadhaar: "drop",
  // An S3 key for a scanned Aadhaar card. Worse than the number: it is a
  // pointer to the document itself.
  aadhaarKey: "drop",

  // PAN is identifying but is also how an admin recognises a record, so it is
  // masked rather than dropped.
  panCard: "mask4",

  // bcrypt hashes. Offline-crackable, and members reuse passwords.
  password: "drop",
  passwordHash: "drop",
  // Reversible plaintext credential (SEC-02). buildSocietyExportBundle
  // already deletes society.credentials.plainPassword explicitly; this makes
  // the guarantee hold anywhere else it might appear.
  plainPassword: "drop",
};

function mask4(value) {
  const s = String(value);
  if (s.length <= 4) return "•".repeat(s.length);
  return "•".repeat(s.length - 4) + s.slice(-4);
}

// Walks a lean() document tree and applies REDACTIONS by key name at any
// depth. Returns a new object; the input is never mutated (it may be a live
// Mongoose lean result shared with a caller).
export function redactDoc(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redactDoc);
  if (typeof value !== "object") return value;

  // Leave BSON values (ObjectId, Date, Decimal128, Buffer) intact — they have
  // no redactable children and recursing into them would destroy them.
  if (value instanceof Date) return value;
  if (typeof value._bsontype === "string") return value;
  if (typeof value.toHexString === "function") return value;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return value;

  const out = {};
  for (const [key, child] of Object.entries(value)) {
    const rule = REDACTIONS[key];
    if (rule === "drop") continue;
    if (rule === "mask4") {
      if (child !== null && child !== undefined && child !== "") out[key] = mask4(child);
      continue;
    }
    out[key] = redactDoc(child);
  }
  return out;
}

export function redactDocs(docs) {
  return docs.map(redactDoc);
}

// Human-readable summary for the export UI and the handover receipt, so the
// society is told what was withheld rather than discovering a blank column.
export const REDACTION_NOTICE = [
  "Aadhaar numbers and Aadhaar document references are excluded from this export (Aadhaar Act s.29).",
  "PAN numbers are masked to their last 4 characters.",
  "Password hashes are excluded.",
];

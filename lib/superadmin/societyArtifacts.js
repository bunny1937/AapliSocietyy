import { createHash } from "node:crypto";
import { buildSocietyExportBundle } from "./societyBundle";
import { buildSocietyExcelBuffer } from "./societyExcel";
import { buildManifest, manifestSummary, newSalt } from "./societyManifest";

// One place that turns a society into the exact bytes a recipient receives.
//
// Every caller goes through here — the superadmin download today, the emailed
// handover in Phase 3 — so the SHA-256 recorded at export time is the hash of
// the same bytes the recipient will later hash in their browser. If the
// download route serialised the bundle its own way, the two would differ by a
// space and every confirmation would fail.
//
// Nothing here writes to disk. The buffers are built, hashed, handed to the
// caller to stream, and dropped.

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * @param societyId
 * @param opts.salt reuse an existing salt (re-streaming a handover the
 *        recipient already has a manifest for); a new one is generated
 *        otherwise
 * @returns null if the society doesn't exist, else
 *   { bundle, manifest, salt, stem, json: {buffer, sha256, filename},
 *     xlsx: {buffer, sha256, filename} }
 */
export async function buildSocietyArtifacts(societyId, { salt: existingSalt } = {}) {
  const bundle = await buildSocietyExportBundle(societyId);
  if (!bundle) return null;

  const salt = existingSalt || newSalt();
  // Computed from the data — collections and the society record — not from the
  // serialised file, so embedding the summary below cannot change the root.
  const manifest = buildManifest(bundle, salt);

  // The file describes itself: a recipient opening the JSON a year later can
  // see what it was supposed to contain and check it independently. Only the
  // summary goes in — per-field leaves would bloat the file for no benefit,
  // since verification recomputes them from the stored salt.
  bundle.manifest = manifestSummary(manifest);

  const stem = `society-export-${bundle.society?.societyId || societyId}-${Date.now()}`;
  const jsonBuffer = Buffer.from(JSON.stringify(bundle, null, 2), "utf8");
  const xlsxBuffer = await buildSocietyExcelBuffer(bundle);

  return {
    bundle,
    manifest,
    salt,
    stem,
    json: { buffer: jsonBuffer, sha256: sha256(jsonBuffer), filename: `${stem}.json`, bytes: jsonBuffer.length },
    xlsx: { buffer: xlsxBuffer, sha256: sha256(xlsxBuffer), filename: `${stem}.xlsx`, bytes: xlsxBuffer.length },
  };
}

/** Shape stored on SocietyHandover.artifacts. */
export function artifactRecords({ json, xlsx }) {
  return [
    { format: "json", filename: json.filename, sha256: json.sha256, bytes: json.bytes },
    { format: "xlsx", filename: xlsx.filename, sha256: xlsx.sha256, bytes: xlsx.bytes },
  ];
}

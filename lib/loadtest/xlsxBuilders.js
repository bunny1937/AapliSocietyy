// lib/loadtest/xlsxBuilders.js
//
// Browser-safe synthetic XLSX builders for the Load Test Lab page
// (app/admin/loadtest-lab/page.js). Uses the SAME `exceljs` library your
// server already parses with (already a project dependency, so nothing new
// to install) -- guarantees the generated files are byte-compatible with
// what /api/members/import and /api/billing/upload-payments expect.
//
// Every lane now runs against its OWN auto-provisioned, empty society (see
// provisioning.js), so cross-run collisions are structurally near-
// impossible. We still tag every row with a run tag and keep everything on
// one wing for clarity/debugging and for the rare "paste an existing
// token" manual lane, where a real pre-existing society is in play:
//   db.members.deleteMany({ wing: "LOADTEST" })
//   db.users.deleteMany({ "profiles.wing": "LOADTEST" })
//
// `startIndex` lets a lane generate a SECOND, non-overlapping batch (used
// by the concurrent phase, which runs alongside the individual/baseline
// batch's data instead of re-using the same flatNo/phone/email range).
//
// Column names below are copied exactly from validateImportData() and
// upsertMemberUser() in app/api/members/import/route.js, and from the
// preview parser in app/api/billing/upload-payments/route.js. If you
// change those routes' expected columns, update the header rows here too.

export const LOADTEST_WING = "LOADTEST";

function pad(n, len = 3) {
  return String(n).padStart(len, "0");
}

// Turns a short run tag (e.g. "R4K2A") into a stable 6-digit numeric seed
// so every run gets its own phone-number range -- avoids colliding with a
// previous test round's rows (which would otherwise fail as duplicates).
function tagSeed(runTag) {
  let h = 0;
  for (const ch of runTag) h = (h * 31 + ch.charCodeAt(0)) % 900000;
  return h + 100000; // always 6 digits
}

export function makeRunTag() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

// Builds the "1. Basic Info (Required)" sheet the enhanced import template
// expects. `runTag` must be unique per test round -- it is embedded in
// flatNo/phone/email so re-running the lab never collides with the
// previous round's rows. `startIndex` (default 1) offsets the row numbers
// so a second batch in the same lane/society never collides with the
// first (e.g. baseline uses 1..N, the concurrent phase uses N+1..2N).
export async function buildMemberImportWorkbook({ count, runTag, startIndex = 1 }) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("1. Basic Info (Required)");
  sheet.addRow([
    "flatNo",
    "wing",
    "floor",
    "ownerName",
    "contactNumber",
    "emailPrimary",
    "carpetAreaSqft",
    "flatType",
    "ownershipType",
    "openingPrincipal",
    "openingInterest",
  ]);
  const seed = tagSeed(runTag);
  const end = startIndex + count - 1;
  for (let i = startIndex; i <= end; i++) {
    const flatNo = `${runTag}-${pad(i, 4)}`;
    // 10 digits total: "9" + 6-digit seed + up to 4-digit row index (clamped).
    const contactNumber = `9${String(seed).padStart(6, "0")}${pad(i % 1000, 3)}`.slice(0, 10);
    sheet.addRow([
      flatNo,
      LOADTEST_WING,
      Math.ceil(i / 10),
      // Letters/spaces only -- the route rejects owner names with digits or
      // punctuation, so uniqueness lives in phone/email/flatNo instead.
      "Loadtest Owner",
      contactNumber,
      `loadtest.${runTag.toLowerCase()}.${i}@example-loadtest.invalid`,
      600 + (i % 40) * 10, // stays well inside the 100-10000 accepted range
      "2BHK",
      "Owner",
      0,
      0,
    ]);
  }
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// Builds a payment-import xlsx matching the columns validatePaymentRows()
// and the preview parser expect. "Wing-FlatNo" must resolve, after the
// route's own first-dash split, back to wing="LOADTEST" and
// flatNo="<runTag>-NNNN" -- exactly what buildMemberImportWorkbook created.
// `startIndex`/`count` should match the member batch you are paying for.
export async function buildPaymentImportWorkbook({
  count,
  month,
  year,
  amount,
  runTag,
  startIndex = 1,
}) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Payments");
  sheet.addRow([
    "Wing-FlatNo",
    "AmountPaid",
    "PaymentDate",
    "Month",
    "Year",
    "PaymentMethod",
    "Remarks",
  ]);
  const today = new Date().toISOString().split("T")[0];
  const end = startIndex + count - 1;
  for (let i = startIndex; i <= end; i++) {
    sheet.addRow([
      `${LOADTEST_WING}-${runTag}-${pad(i, 4)}`,
      amount,
      today,
      month,
      year,
      "Cash",
      `loadtest run ${runTag}`,
    ]);
  }
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

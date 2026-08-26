import { buildWorkbook, addSheetFromAoa, styleHeaderRow, workbookBuffer } from "@/lib/excelParse";
import { SOCIETY_COLLECTIONS } from "./societyCollections";

// Human-readable half of the LOOP-05 export. The JSON bundle stays the
// machine-truth artifact (it's what verify-export and restore read, because
// only JSON round-trips ObjectIds/Dates losslessly); this workbook is the
// same data laid out for a human — and, critically, laid out in the SAME
// shape /api/admin/bulk-import/template hands out, so an exported society can
// be re-onboarded through the normal bulk-import flow instead of only through
// a restore.
//
//   Sheet 1     Society                    ← identical headers to the bulk-import template
//   Sheets 2-7  Member sheets              ← identical headers to the bulk-import template
//   Sheets 8+   One per remaining non-empty collection in the bundle
//                (bills, receipts, transactions, notices, complaints,
//                 journal lines, …) — raw field dump, one row per document.

const SOCIETY_HEADERS = [
  "Society Name",
  "Registration No",
  "Address",
  "Date of Registration",
  "PAN No",
  "TAN No",
  "Admin Full Name",
  "Admin Email",
  "Contact Person",
  "Contact Email",
  "Contact Phone",
  "Bill Creation Day*",
  "Payment Upload Day*",
  "Bill Due Day*",
  "Interest Starts After Due Date (Days)",
  "Maintenance Rate (Per Sq Ft)",
  "Sinking Fund Rate (Per Sq Ft)",
  "Repair Fund Rate (Per Sq Ft)",
  "Water Charges (Fixed)",
  "Security Charges (Fixed)",
  "Electricity Charges (Fixed)",
  "Open Parking TW (Per Vehicle)",
  "Open Parking FW (Per Vehicle)",
  "Covered Parking TW (Per Vehicle)",
  "Covered Parking FW (Per Vehicle)",
];

// Header → the charges[] label bulkImportValidate.rowToSocietyPayload writes
// for that column. Same mapping read backwards, so export → import is a
// round trip rather than two independent guesses at the same vocabulary.
const CHARGE_BY_HEADER = {
  "Maintenance Rate (Per Sq Ft)": "Maintenance Charges",
  "Sinking Fund Rate (Per Sq Ft)": "Sinking Fund",
  "Repair Fund Rate (Per Sq Ft)": "Repair Fund",
  "Water Charges (Fixed)": "Water Charges",
  "Security Charges (Fixed)": "Security Charges",
  "Electricity Charges (Fixed)": "Electricity Charges",
  "Open Parking TW (Per Vehicle)": "Open Parking - Two Wheeler",
  "Open Parking FW (Per Vehicle)": "Open Parking - Four Wheeler",
  "Covered Parking TW (Per Vehicle)": "Covered Parking - Two Wheeler",
  "Covered Parking FW (Per Vehicle)": "Covered Parking - Four Wheeler",
};

const MEMBER_SHEET_NAMES = {
  basic: "1. Basic Info (Required)",
  additional: "2. Additional Details",
  parking: "3. Parking Slots",
  family: "4. Family Members",
  owners: "5. Owner History",
  tenants: "6. Tenant History",
};

// ── cell coercion ─────────────────────────────────────────────────────────
// Excel cells hold scalars. Anything structural (subdocument, array, Buffer)
// is written as compact JSON so nothing is silently dropped — the bundle
// stays the source of truth for restoring, this keeps the sheet honest.
function cell(v) {
  if (v === undefined || v === null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "object") {
    if (typeof v._bsontype === "string" || typeof v.toHexString === "function") return String(v);
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(v)) return v.toString("base64");
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function isoDate(v) {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

// Excel forbids : \ / ? * [ ] in sheet names and caps them at 31 chars, and
// duplicates throw — so every generated name goes through here.
function sheetName(base, used) {
  let name = String(base).replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || "Sheet";
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  for (let i = 2; ; i++) {
    const suffix = ` (${i})`;
    const candidate = name.slice(0, 31 - suffix.length) + suffix;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

const plural = (label) => (label.endsWith("s") ? label : label.endsWith("y") ? `${label.slice(0, -1)}ies` : `${label}s`);

// ── sheet builders ────────────────────────────────────────────────────────

function societyRow(society) {
  const charges = society?.config?.charges || [];
  const chargeValue = (header) => {
    const wanted = CHARGE_BY_HEADER[header];
    const hit = charges.find((c) => String(c?.label || "").toLowerCase() === wanted.toLowerCase());
    return hit ? hit.value ?? 0 : 0;
  };
  const cfg = society?.config || {};
  return SOCIETY_HEADERS.map((h) => {
    switch (h) {
      case "Society Name": return society?.name || "";
      case "Registration No": return society?.registrationNo || "";
      case "Address": return society?.address || "";
      case "Date of Registration": return isoDate(society?.dateOfRegistration);
      case "PAN No": return society?.panNo || "";
      case "TAN No": return society?.tanNo || "";
      case "Admin Full Name": return society?.credentials?.adminName || society?.personOfContact || "";
      case "Admin Email": return society?.credentials?.adminEmail || society?.contactEmail || "";
      case "Contact Person": return society?.personOfContact || "";
      case "Contact Email": return society?.contactEmail || "";
      case "Contact Phone": return society?.contactPhone || "";
      case "Bill Creation Day*": return cfg.billGenerationDay ?? "";
      case "Payment Upload Day*": return cfg.paymentUploadDay ?? "";
      case "Bill Due Day*": return cfg.billDueDay ?? "";
      case "Interest Starts After Due Date (Days)": return cfg.interestAfterDays ?? "";
      default: return chargeValue(h);
    }
  });
}

function memberSheets(members) {
  const basic = [[
    "flatNo*", "wing", "floor", "ownerName*", "contactNumber*", "emailPrimary*",
    "carpetAreaSqft*", "flatType", "ownershipType", "openingPrincipal", "openingInterest", "advanceCredit",
  ]];
  const additional = [[
    "flatNo*", "panCard", "aadhaar", "alternateContact", "whatsappNumber",
    "emailSecondary", "builtUpAreaSqft", "possessionDate",
  ]];
  const parking = [["flatNo*", "slotNumber", "type", "vehicleType"]];
  const family = [["flatNo*", "name", "relation", "age", "contactNumber", "occupation"]];
  const owners = [[
    "flatNo*", "ownerSequence", "ownerName", "contactNumber", "emailPrimary", "panCard",
    "ownershipStartDate", "ownershipEndDate", "purchaseAmount", "saleAmount",
  ]];
  const tenants = [[
    "flatNo*", "tenantSequence", "name", "contactNumber", "email", "panCard",
    "startDate", "endDate", "depositAmount", "rentPerMonth", "isCurrent",
  ]];

  for (const m of members) {
    const flat = m.flatNo ?? "";
    basic.push([
      flat, m.wing ?? "", m.floor ?? "", m.ownerName ?? "", m.contactNumber ?? "", m.emailPrimary ?? "",
      m.carpetAreaSqft ?? "", m.flatType ?? "", m.ownershipType ?? "",
      m.openingPrincipal ?? 0, m.openingInterest ?? 0, m.advanceCredit ?? 0,
    ]);
    additional.push([
      flat, m.panCard ?? "", m.aadhaar ?? "", m.alternateContact ?? "", m.whatsappNumber ?? "",
      m.emailSecondary ?? "", m.builtUpAreaSqft ?? "", isoDate(m.possessionDate),
    ]);
    for (const p of m.parkingSlots || []) {
      parking.push([flat, p.slotNumber ?? "", p.type ?? "", p.vehicleType ?? ""]);
    }
    for (const f of m.familyMembers || []) {
      family.push([flat, f.name ?? "", f.relation ?? "", f.age ?? "", f.contactNumber ?? "", f.occupation ?? ""]);
    }
    // Only PREVIOUS owners belong on the Owner History sheet — the current
    // owner already occupies the Basic Info row, and the import treats a
    // duplicate there as a second owner.
    (m.ownerHistory || [])
      .filter((o) => !o.isCurrent)
      .forEach((o, i) => {
        owners.push([
          flat, i + 1, o.ownerName ?? "", o.contactNumber ?? "", o.emailPrimary ?? "", o.panCard ?? "",
          isoDate(o.ownershipStartDate), isoDate(o.ownershipEndDate), o.purchaseAmount ?? "", o.saleAmount ?? "",
        ]);
      });
    // tenantHistory holds past tenants; currentTenant is a separate field —
    // emitted last with isCurrent = Yes, matching what the import expects.
    const tenantRows = [...(m.tenantHistory || [])];
    if (m.currentTenant) tenantRows.push({ ...m.currentTenant, isCurrent: true });
    tenantRows.forEach((t, i) => {
      tenants.push([
        flat, i + 1, t.name ?? "", t.contactNumber ?? "", t.email ?? "", t.panCard ?? "",
        isoDate(t.startDate), isoDate(t.endDate), t.depositAmount ?? "", t.rentPerMonth ?? "",
        t.isCurrent ? "Yes" : "No",
      ]);
    });
  }

  return [
    { name: MEMBER_SHEET_NAMES.basic, rows: basic },
    { name: MEMBER_SHEET_NAMES.additional, rows: additional },
    { name: MEMBER_SHEET_NAMES.parking, rows: parking },
    { name: MEMBER_SHEET_NAMES.family, rows: family },
    { name: MEMBER_SHEET_NAMES.owners, rows: owners },
    { name: MEMBER_SHEET_NAMES.tenants, rows: tenants },
  ];
}

// One sheet per remaining collection: union of every key across its documents
// as the header row (documents of the same collection legitimately differ in
// shape), then one row per document.
function rawSheetRows(docs) {
  const headers = [];
  const seen = new Set();
  for (const doc of docs) {
    for (const k of Object.keys(doc)) {
      if (k === "__v" || seen.has(k)) continue;
      seen.add(k);
      headers.push(k);
    }
  }
  // _id, societyId first — the two columns anyone scanning the sheet looks
  // for — then the rest in discovery order.
  headers.sort((a, b) => rank(a) - rank(b));
  return [headers, ...docs.map((d) => headers.map((h) => cell(d[h])))];
}
function rank(key) {
  if (key === "_id") return -2;
  if (key === "societyId") return -1;
  return 0;
}

const LABEL_BY_KEY = Object.fromEntries(SOCIETY_COLLECTIONS.map((c) => [c.key, c.label]));

/**
 * @param bundle the JSON export bundle from buildSocietyExportBundle
 * @returns {Promise<Buffer>} .xlsx bytes
 */
export async function buildSocietyExcelBuffer(bundle) {
  const wb = buildWorkbook();
  const used = new Set();
  const society = bundle?.society || {};
  const collections = bundle?.collections || {};

  // ── Sheet 1: Society (bulk-import shape) ──
  const societySheet = addSheetFromAoa(wb, sheetName("Society", used), [SOCIETY_HEADERS, societyRow(society)], {
    colWidths: SOCIETY_HEADERS.map((h) => Math.max(h.length + 4, 18)),
  });
  styleHeaderRow(societySheet);

  // ── Sheets 2-7: Members (bulk-import shape) ──
  for (const { name, rows } of memberSheets(collections.members || [])) {
    const ws = addSheetFromAoa(wb, sheetName(name, used), rows, {
      colWidths: rows[0].map((h) => Math.max(String(h).length + 4, 16)),
    });
    styleHeaderRow(ws);
  }

  // ── Sheets 8+: everything else the society owns, one sheet per collection ──
  const extras = [];
  for (const { key, label } of SOCIETY_COLLECTIONS) {
    if (key === "members") continue; // already expanded across sheets 2-7
    const docs = collections[key];
    if (docs?.length) extras.push({ label: plural(label), docs });
  }
  if (collections.users?.length) extras.push({ label: "Users", docs: collections.users });
  if (collections.userProfileRefs?.length) {
    extras.push({ label: "User Profile Refs", docs: collections.userProfileRefs });
  }

  for (const entry of extras) {
    const { label, docs } = entry;
    const rows = rawSheetRows(docs);
    entry.sheet = sheetName(label, used);
    const ws = addSheetFromAoa(wb, entry.sheet, rows, {
      colWidths: rows[0].map((h) => Math.min(Math.max(String(h).length + 4, 14), 60)),
    });
    styleHeaderRow(ws, "FF7C3AED"); // violet — visually separates the raw
                                    // data-dump sheets from the blue
                                    // bulk-import-shaped ones above
  }

  // ── Manifest: what's in the file, so a reader can tell an empty
  //    collection from a missing one ──
  const manifest = [
    ["Collection", "Sheet", "Records"],
    ["society", "Society", 1],
    ["members", "1. Basic Info (Required)", (collections.members || []).length],
    ...extras.map(({ label, sheet, docs }) => [label, sheet, docs.length]),
    [],
    ["Exported at", bundle?.exportedAt || ""],
    ["Format version", bundle?.formatVersion ?? ""],
    ["Society id", bundle?.societyId || ""],
    // The root identifies this export in one value. Quoting it in a support
    // request is enough for us to find the matching handover record.
    ["Manifest root", bundle?.manifest?.root || ""],
    [],
    ["NOTE: This workbook is the human-readable copy. Verifying or restoring a"],
    ["deletion requires the .json export downloaded alongside it — Excel cells"],
    ["cannot round-trip ObjectIds, timestamps and nested documents exactly."],
    [],
    // The bulk-import column layout is preserved exactly, so redacted columns
    // are present but blank rather than removed — a missing column would break
    // re-import, and a silently empty one would look like lost data.
    ["WITHHELD FROM THIS EXPORT:"],
    ...(bundle?.redactions || []).map((line) => [line]),
  ];
  const mws = addSheetFromAoa(wb, sheetName("_Manifest", used), manifest, { colWidths: [34, 34, 12] });
  styleHeaderRow(mws, "FF334155");

  return workbookBuffer(wb);
}

export { SOCIETY_HEADERS, LABEL_BY_KEY };

import ExcelJS from "exceljs";

// Excel read/write for the whole app, on exceljs — not xlsx/SheetJS, which
// has an unfixed prototype-pollution + ReDoS CVE in its parser
// (GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9) with no patched release. The
// parsing functions below matter most (that's the attacker-reachable path,
// uploaded files), but the write-side helpers are here too so nothing in
// this codebase depends on the `xlsx` package at all.

export async function loadWorkbook(input) {
  const workbook = new ExcelJS.Workbook();
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  await workbook.xlsx.load(buffer);
  return workbook;
}

function cellValue(cell) {
  let val = cell?.value;
  if (val && typeof val === "object" && !(val instanceof Date)) {
    if (Array.isArray(val.richText)) val = val.richText.map((t) => t.text).join("");
    else if (val.text !== undefined) val = val.text;
    else if (val.result !== undefined) val = val.result;
    else if (val.hyperlink !== undefined) val = val.text ?? val.hyperlink;
  }
  return val;
}

// Mirrors XLSX.utils.sheet_to_json: first row is headers, every subsequent
// row becomes an object keyed by header. Like the original, a blank cell's
// key is omitted entirely unless `defval` is passed (matching `{ defval: ""
// }` call sites elsewhere in this codebase). Fully-blank rows are skipped
// UNLESS `blankrows: true` is passed — some callers rely on a blank
// separator row surviving in the output (e.g. bulk-import's "stop at the
// first blank row" loop), matching SheetJS's own `blankrows` option.
export function worksheetToJson(worksheet, { defval, blankrows = false } = {}) {
  if (!worksheet) return [];
  const headers = [];
  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cellValue(cell) ?? "").trim();
  });

  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj = {};
    let hasValue = false;
    headers.forEach((header, idx) => {
      if (!header) return;
      const raw = cellValue(row.getCell(idx + 1));
      const blank = raw === null || raw === undefined || raw === "";
      if (blank && defval === undefined) return; // omit key, like real SheetJS default
      obj[header] = blank ? defval : raw;
      if (!blank) hasValue = true;
    });
    if (hasValue || blankrows) rows.push(obj);
  });
  return rows;
}

// Convenience for the common single-sheet case.
export async function parseFirstSheet(input, options = {}) {
  const workbook = await loadWorkbook(input);
  return worksheetToJson(workbook.worksheets[0], options);
}

// Array-of-arrays form of a worksheet's contents.
export function worksheetToAoa(worksheet) {
  const aoa = [];
  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const arr = [];
    row.eachCell({ includeEmpty: true }, (cell) => arr.push(cellValue(cell) ?? null));
    aoa[rowNumber - 1] = arr;
  });
  return aoa;
}

// ── Write side (templates, exports) ─────────────────────────────────────
// All server-owned data, never attacker-controlled — but kept on exceljs
// too so the `xlsx` package has zero references anywhere in the codebase.

export function buildWorkbook() {
  return new ExcelJS.Workbook();
}

// Mirrors XLSX.utils.aoa_to_sheet + book_append_sheet: adds a sheet from a
// plain array-of-arrays, one row per array entry.
export function addSheetFromAoa(workbook, name, aoa, { colWidths } = {}) {
  const ws = workbook.addWorksheet(name);
  aoa.forEach((row) => ws.addRow(row));
  if (colWidths) colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  return ws;
}

// Mirrors XLSX.utils.json_to_sheet + book_append_sheet: header row from the
// union of keys across all rows (rows can have different shapes — e.g. a
// spread of a per-member charges object), then one row per object. Pass
// `headers` to pin an exact column order instead (mirrors json_to_sheet's
// `{ header: [...] }` option) — needed wherever column order must be
// deterministic regardless of which keys the first row happens to have.
export function addSheetFromJson(workbook, name, rows, { colWidths, headers: explicitHeaders } = {}) {
  let headers = explicitHeaders;
  if (!headers) {
    headers = [];
    const seen = new Set();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!seen.has(key)) { seen.add(key); headers.push(key); }
      }
    }
  }
  const ws = workbook.addWorksheet(name);
  ws.columns = headers.map((key) => ({ header: key, key }));
  ws.addRows(rows);
  if (colWidths) colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  return ws;
}

// Bold white-on-color header row — the styling every template in this
// codebase uses (see lib/excel-handler.js for the original convention).
export function styleHeaderRow(worksheet, argb = "FF2563EB") {
  const row = worksheet.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
}

export async function workbookBuffer(workbook) {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ── Upload safety (attacker-controlled files) ─────────────────────────────
// Added for test 04 (XLSX penetration). Used by
// app/api/billing/upload-payments — free for any future upload route.

const MAX_UPLOAD_ROWS = 5_000;   // a society billing sheet is < 500 rows
const MAX_UPLOAD_COLS = 50;
const MAX_CELL_LEN = 500;

/**
 * Parse an uploaded .xlsx defensively. Returns { worksheet, workbook } or
 * { error, status } — always a 400-family answer, never a thrown 500.
 *  a) content sniffing: a real .xlsx is a zip ("PK" magic) — kills renamed
 *     PNGs and null-byte files regardless of extension or client MIME
 *  b) bounded parse: a crafted zip (zipbomb) must not pin the lambda
 *  c) row/column caps: huge_rows / wide_cols stop here
 */
export async function parseXlsxSafely(bytesBuffer) {
  const isZip =
    bytesBuffer.length > 4 && bytesBuffer[0] === 0x50 && bytesBuffer[1] === 0x4b;
  if (!isZip) return { error: "Not a valid .xlsx file", status: 400 };

  const workbook = new ExcelJS.Workbook();
  try {
    await Promise.race([
      workbook.xlsx.load(bytesBuffer),
      new Promise((_, rej) => setTimeout(() => rej(new Error("parse timeout")), 10_000)),
    ]);
  } catch {
    return { error: "Could not parse spreadsheet", status: 400 };
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) return { error: "Empty file", status: 400 };
  if (worksheet.rowCount > MAX_UPLOAD_ROWS)
    return { error: `Too many rows (max ${MAX_UPLOAD_ROWS})`, status: 400 };
  if (worksheet.columnCount > MAX_UPLOAD_COLS)
    return { error: `Too many columns (max ${MAX_UPLOAD_COLS})`, status: 400 };
  return { workbook, worksheet };
}

/**
 * Neutralize a parsed cell before it is echoed in previews or re-exported to
 * CSV/Excel: strips null bytes, caps length, and prefixes a quote when the
 * value starts with a formula trigger (= + - @ tab CR). Pure numeric strings
 * ("-500") are left alone — they are data, not formulas.
 */
export function neutralizeCell(v) {
  if (typeof v !== "string") return v;
  let s = v.replace(/\0/g, "");
  if (s.length > MAX_CELL_LEN) s = s.slice(0, MAX_CELL_LEN);
  if (/^-?\d+(\.\d+)?$/.test(s.trim())) return s; // plain number, safe
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

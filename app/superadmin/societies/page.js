"use client";
import { useState, useEffect } from "react";
import ExcelJS from "exceljs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/Admin.module.css";
import DropZone from "../../../components/DropZone";
import BulkImportWizard from "./BulkImportWizard";

// exceljs for all reading and writing — not `xlsx`/SheetJS, which has an
// unfixed prototype-pollution + ReDoS CVE in its parser (GHSA-4r6h-8v6p-xvw6,
// GHSA-5pgg-2g8v-p4x9). `xlsx` is not used anywhere in this codebase.
function cellVal(cell) {
  let val = cell?.value;
  if (val && typeof val === "object" && !(val instanceof Date)) {
    if (Array.isArray(val.richText)) val = val.richText.map((t) => t.text).join("");
    else if (val.text !== undefined) val = val.text;
    else if (val.result !== undefined) val = val.result;
  }
  return val;
}
function sheetToRows(worksheet, { defval = "" } = {}) {
  if (!worksheet) return [];
  const headers = [];
  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cellVal(cell) ?? "").trim();
  });
  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj = {};
    let hasValue = false;
    headers.forEach((header, idx) => {
      if (!header) return;
      const raw = cellVal(row.getCell(idx + 1));
      const blank = raw === null || raw === undefined || raw === "";
      obj[header] = blank ? defval : raw;
      if (!blank) hasValue = true;
    });
    if (hasValue) rows.push(obj);
  });
  return rows;
}
async function loadWorkbookFromArrayBuffer(arrayBuffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);
  return workbook;
}
// ── Validation Rules ──────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const TAN_RE = /^[A-Z]{4}[0-9]{5}[A-Z]{1}$/;
const PHONE_RE = /^[6-9]\d{9}$/;
function validateRows(rows) {
  const errors = [];
  const seenEmails = {};
  const seenNames = {};
  rows.forEach((row, idx) => {
    const r = idx + 2; // Excel row number (1=header, so data starts at 2)
    const e = (msg) => errors.push({ row: r, field: msg });
    // Required
    if (!row["Society Name"]?.toString().trim()) e("Society Name is required");
    if (!row["Address"]?.toString().trim()) e("Address is required");
    if (!row["Admin Full Name"]?.toString().trim())
      e("Admin Full Name is required");
    const adminEmail = row["Admin Email"]?.toString().trim();
    if (!adminEmail) {
      e("Admin Email is required");
    } else if (!EMAIL_RE.test(adminEmail)) {
      e(`Admin Email "${adminEmail}" is not valid`);
    } else {
      if (seenEmails[adminEmail.toLowerCase()]) {
        e(
          `Admin Email "${adminEmail}" is duplicate (also in row ${seenEmails[adminEmail.toLowerCase()]})`,
        );
      }
      seenEmails[adminEmail.toLowerCase()] = r;
    }
    const sName = row["Society Name"]?.toString().trim().toLowerCase();
    if (sName) {
      if (seenNames[sName]) {
        e(
          `Society Name "${row["Society Name"]}" is duplicate (also in row ${seenNames[sName]})`,
        );
      }
      seenNames[sName] = r;
    }
    // Optional but format-checked
    const pan = row["PAN No"]?.toString().trim();
    if (pan && !PAN_RE.test(pan))
      e(`PAN No "${pan}" must be format AAAAA0000A`);
    const tan = row["TAN No"]?.toString().trim();
    if (tan && !TAN_RE.test(tan))
      e(`TAN No "${tan}" must be format AAAA00000A`);
    const contactEmail = row["Contact Email"]?.toString().trim();
    if (contactEmail && !EMAIL_RE.test(contactEmail))
      e(`Contact Email "${contactEmail}" is not valid`);
    const phone = row["Contact Phone"]?.toString().trim().replace(/\s/g, "");
    if (phone && !PHONE_RE.test(phone))
      e(`Contact Phone "${phone}" must be 10 digits starting with 6-9`);
    const dor = row["Date of Registration"]?.toString().trim();
    if (dor) {
      const parsed = new Date(dor);
      if (isNaN(parsed.getTime()))
        e(`Date of Registration "${dor}" is not a valid date`);
      else if (parsed > new Date())
        e(`Date of Registration "${dor}" cannot be in the future`);
    }
    const ir = parseFloat(row["Interest Rate %"]);
    if (row["Interest Rate %"] !== undefined && row["Interest Rate %"] !== "") {
      if (isNaN(ir) || ir < 0 || ir > 100)
        e(
          `Interest Rate must be a number between 0–100, got "${row["Interest Rate %"]}"`,
        );
    }
    for (const label of ["Bill Creation Day*", "Payment Upload Day*", "Bill Due Day*"]) {
      const value = Number(row[label]);
      if (!Number.isInteger(value) || value < 1 || value > 31) {
        e(`${label} must be a whole number from 1 to 31, got "${row[label]}"`);
      }
    }
    const iad = parseInt(row["Interest Starts After Due Date (Days)"]);
    if (!isNaN(iad) && (iad < 0 || iad > 365)) {
      e(`Interest Starts After Due Date (Days) must be 0–365, got "${row["Interest Starts After Due Date (Days)"]}"`);
    }
    // Charge amounts must be numeric and non-negative
    const chargeFields = [
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
    chargeFields.forEach((f) => {
      const val = row[f];
      if (val !== undefined && val !== "") {
        const n = parseFloat(val);
        if (isNaN(n) || n < 0)
          e(`${f} must be a non-negative number, got "${val}"`);
      }
    });
  });
  return errors;
}
function rowToSocietyPayload(row) {
  const charges = [
    {
      label: "Maintenance Charges",
      type: "Per Sq Ft",
      value: parseFloat(row["Maintenance Rate (Per Sq Ft)"]) || 0,
      isActive: true,
      vehicleType: null,
    },
    {
      label: "Sinking Fund",
      type: "Per Sq Ft",
      value: parseFloat(row["Sinking Fund Rate (Per Sq Ft)"]) || 0,
      isActive: true,
      vehicleType: null,
    },
    {
      label: "Repair Fund",
      type: "Per Sq Ft",
      value: parseFloat(row["Repair Fund Rate (Per Sq Ft)"]) || 0,
      isActive: true,
      vehicleType: null,
    },
    {
      label: "Water Charges",
      type: "Fixed",
      value: parseFloat(row["Water Charges (Fixed)"]) || 0,
      isActive: true,
      vehicleType: null,
    },
    {
      label: "Security Charges",
      type: "Fixed",
      value: parseFloat(row["Security Charges (Fixed)"]) || 0,
      isActive: true,
      vehicleType: null,
    },
    {
      label: "Electricity Charges",
      type: "Fixed",
      value: parseFloat(row["Electricity Charges (Fixed)"]) || 0,
      isActive: true,
      vehicleType: null,
    },
    {
      label: "Open Parking - Two Wheeler",
      type: "Per Vehicle",
      value: parseFloat(row["Open Parking TW (Per Vehicle)"]) || 0,
      isActive: parseFloat(row["Open Parking TW (Per Vehicle)"]) > 0,
      vehicleType: "Two-Wheeler",
    },
    {
      label: "Open Parking - Four Wheeler",
      type: "Per Vehicle",
      value: parseFloat(row["Open Parking FW (Per Vehicle)"]) || 0,
      isActive: parseFloat(row["Open Parking FW (Per Vehicle)"]) > 0,
      vehicleType: "Four-Wheeler",
    },
    {
      label: "Covered Parking - Two Wheeler",
      type: "Per Vehicle",
      value: parseFloat(row["Covered Parking TW (Per Vehicle)"]) || 0,
      isActive: parseFloat(row["Covered Parking TW (Per Vehicle)"]) > 0,
      vehicleType: "Two-Wheeler",
    },
    {
      label: "Covered Parking - Four Wheeler",
      type: "Per Vehicle",
      value: parseFloat(row["Covered Parking FW (Per Vehicle)"]) || 0,
      isActive: parseFloat(row["Covered Parking FW (Per Vehicle)"]) > 0,
      vehicleType: "Four-Wheeler",
    },
  ];
  return {
    societyName: row["Society Name"]?.toString().trim(),
    registrationNo: row["Registration No"]?.toString().trim() || "",
    address: row["Address"]?.toString().trim() || "",
    dateOfRegistration: row["Date of Registration"]?.toString().trim() || "",
    panNo: row["PAN No"]?.toString().trim() || "",
    tanNo: row["TAN No"]?.toString().trim() || "",
    fullName: row["Admin Full Name"]?.toString().trim(),
    email: row["Admin Email"]?.toString().trim(),
    personOfContact: row["Contact Person"]?.toString().trim() || "",
    contactEmail: row["Contact Email"]?.toString().trim() || "",
    contactPhone: row["Contact Phone"]?.toString().trim() || "",
    config: {
      charges: charges.filter((c) => c.label),
      interestRate: parseFloat(row["Interest Rate %"]) || 21,
      billGenerationDay: parseInt(row["Bill Creation Day*"]),
      paymentUploadDay: parseInt(row["Payment Upload Day*"]),
      billDueDay: parseInt(row["Bill Due Day*"]),
      interestAfterDays: parseInt(row["Interest Starts After Due Date (Days)"]) || 15,
    },
  };
}
// ── Template Download ─────────────────────────────────────────────
async function downloadTemplate() {
  const headers = [
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
    "Interest Rate %",
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
  const sample = [
    "Godbole Heights",
    "MH/2010/001",
    "Adharwadi, Kalyan, Maharashtra",
    "01/04/2010",
    "AABCG1234D",
    "MUMG12345A",
    "Ramesh Patil",
    "admin@godboleheights.com",
    "Suresh Patil",
    "secretary@godboleheights.com",
    "9876543210",
    "21",
    1,
    30,
    30,
    15,
    "1.5",
    "0.5",
    "0.25",
    "150",
    "200",
    "100",
    "100",
    "150",
    "200",
    "300",
  ];
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Societies");
  ws.addRow(headers);
  ws.addRow(sample);
  headers.forEach((h, i) => { ws.getColumn(i + 1).width = Math.max(h.length + 4, 18); });
  ws.getRow(1).font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "society_upload_template.xlsx"; a.click();
  URL.revokeObjectURL(url);
}
// ── Bill History Validation Engine ───────────────────────────────────────────
const PAYMENT_METHODS_OK = new Set(["Cash", "Cheque", "Online", "NEFT", "UPI"]);
const TOLERANCE = 0.05; // ₹ rounding tolerance
function validateBillHistorySheet(rows, periodId, prevState, interestRate) {
  // prevState: Map of wingFlat → { closingPrincipal, closingInterest }
  // Returns { ok, errors, warnings, closingState }
  const errors = [];
  const warnings = [];
  const closingState = new Map();
  const seen = new Set();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const r = i + 2;
    const wingFlat = String(row["Wing-FlatNo"] || "").trim();
    if (!wingFlat || wingFlat.startsWith("⚠")) continue;
    const rowPeriod = String(row["Period"] || "").trim();
    if (rowPeriod && rowPeriod !== periodId) {
      errors.push(`Row ${r} [${wingFlat}]: Period "${rowPeriod}" should be "${periodId}"`);
    }
    if (seen.has(wingFlat.toLowerCase())) {
      errors.push(`Row ${r} [${wingFlat}]: Duplicate flat — appears more than once in this sheet`);
      continue;
    }
    seen.add(wingFlat.toLowerCase());
    const n = (k) => parseFloat(row[k] || 0);
    const openingPrincipal = n("OpeningPrincipal");
    const openingInterest = n("OpeningInterest");
    const currentCharges = n("CurrentCharges");
    const currentInterest = n("CurrentInterest");
    const billPrincipal = n("BillPrincipal");
    const billInterest = n("BillInterest");
    const totalBillDue = n("TotalBillDue");
    const alreadyPaid = n("AlreadyPaid");
    const advanceCredit = n("AdvanceCredit");
    const remainingDue = n("RemainingDue");
    const amountPaid = n("AmountPaid");
    // 1. Opening balances vs previous closing — warn only (admin paper books are source of truth)
    if (prevState && prevState.has(wingFlat.toLowerCase())) {
      const prev = prevState.get(wingFlat.toLowerCase());
      const expectedOP = parseFloat(prev.closingPrincipal.toFixed(2));
      const expectedOI = parseFloat(prev.closingInterest.toFixed(2));
      if (Math.abs(openingPrincipal - expectedOP) > TOLERANCE) {
        warnings.push(`Row ${r} [${wingFlat}]: OpeningPrincipal ₹${openingPrincipal} differs from computed prev closing ₹${expectedOP} — using your value.`);
      }
      if (Math.abs(openingInterest - expectedOI) > TOLERANCE) {
        warnings.push(`Row ${r} [${wingFlat}]: OpeningInterest ₹${openingInterest} differs from computed prev closing ₹${expectedOI} — using your value.`);
      }
    }
    // 2. CurrentInterest check — warn only (admin may use different rate or rounding)
    const expectedInterest = parseFloat(((openingPrincipal * interestRate) / 1200).toFixed(2));
    if (openingPrincipal > 0 && Math.abs(currentInterest - expectedInterest) > TOLERANCE) {
      warnings.push(`Row ${r} [${wingFlat}]: CurrentInterest ₹${currentInterest} differs from computed ₹${expectedInterest} (${openingPrincipal} × ${interestRate}% / 12) — using your value.`);
    }
    // 3. BillPrincipal = openingPrincipal + currentCharges
    const expectedBP = parseFloat((openingPrincipal + currentCharges).toFixed(2));
    if (Math.abs(billPrincipal - expectedBP) > TOLERANCE) {
      errors.push(`Row ${r} [${wingFlat}]: BillPrincipal ₹${billPrincipal} ≠ OpeningPrincipal+CurrentCharges (${openingPrincipal}+${currentCharges}=${expectedBP})`);
    }
    // 4. BillInterest = openingInterest + currentInterest
    const expectedBI = parseFloat((openingInterest + currentInterest).toFixed(2));
    if (Math.abs(billInterest - expectedBI) > TOLERANCE) {
      errors.push(`Row ${r} [${wingFlat}]: BillInterest ₹${billInterest} ≠ OpeningInterest+CurrentInterest (${openingInterest}+${currentInterest}=${expectedBI})`);
    }
    // 5. TotalBillDue = billPrincipal + billInterest
    const expectedTBD = parseFloat((billPrincipal + billInterest).toFixed(2));
    if (Math.abs(totalBillDue - expectedTBD) > TOLERANCE) {
      errors.push(`Row ${r} [${wingFlat}]: TotalBillDue ₹${totalBillDue} ≠ BillPrincipal+BillInterest (${billPrincipal}+${billInterest}=${expectedTBD})`);
    }
    // 6. RemainingDue — auto-compute, don't validate against cell value
    // Admin may fill the pre-payment amount; system always derives closing from formula
    const totalPaidThisRow = alreadyPaid + amountPaid + advanceCredit;
    const expectedRD = parseFloat(Math.max(0, totalBillDue - totalPaidThisRow).toFixed(2));
    // 7. PaymentMethod validation
    const pm = String(row["PaymentMethod"] || "").trim();
    if (amountPaid > 0 && pm && !PAYMENT_METHODS_OK.has(pm)) {
      warnings.push(`Row ${r} [${wingFlat}]: PaymentMethod "${pm}" is non-standard. Accepted: Cash/Cheque/Online/NEFT/UPI`);
    }
    // 8. Negative check
    [["OpeningPrincipal", openingPrincipal], ["OpeningInterest", openingInterest],
     ["CurrentCharges", currentCharges], ["AmountPaid", amountPaid]].forEach(([k, v]) => {
      if (v < 0) errors.push(`Row ${r} [${wingFlat}]: ${k} cannot be negative (got ${v})`);
    });
    // Compute closing state for next sheet
    // Payment allocation: interest first, then principal; advance reduces principal
    const totalPayment = alreadyPaid + amountPaid;
    const interestPaid = Math.min(totalPayment, billInterest);
    const principalPaid = Math.max(0, totalPayment - interestPaid);
    const cI = parseFloat(Math.max(0, billInterest - interestPaid).toFixed(2));
    const cP = parseFloat(Math.max(0, billPrincipal - principalPaid - advanceCredit).toFixed(2));
    closingState.set(wingFlat.toLowerCase(), { closingPrincipal: cP, closingInterest: cI });
  }
  return { ok: errors.length === 0, errors, warnings, closingState };
}
// ── BillHistoryStep Component ─────────────────────────────────────────────────
function BillHistoryStep({ societyId, societyName, joinPeriodId, interestRate, onComplete, onSkip }) {
  const [bhFile, setBhFile] = useState(null);
  const [bhStep, setBhStep] = useState("idle"); // idle | validating | saving | done | error
  const [sheetResults, setSheetResults] = useState([]); // per sheet: { periodId, ok, errors, warnings, rowCount }
  const [validationDone, setValidationDone] = useState(false);
  const [allValid, setAllValid] = useState(false);
  const [validatedBills, setValidatedBills] = useState(null); // flat array of bill objects
  const [saveResult, setSaveResult] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [activeSheetIdx, setActiveSheetIdx] = useState(null);
  const handleFileChange = (file) => {
    if (!file) return;
    setBhFile(file);
    setBhStep("validating");
    setSheetResults([]);
    setValidationDone(false);
    setAllValid(false);
    setValidatedBills(null);
    setActiveSheetIdx(null);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const wb = await loadWorkbookFromArrayBuffer(evt.target.result);
        // Skip "Instructions" sheet, process period sheets (named YYYY-MM)
        const periodSheets = wb.worksheets
          .map((ws) => ws.name)
          .filter((n) => /^\d{4}-\d{2}$/.test(n))
          .sort();
        if (!periodSheets.length) {
          setSheetResults([{ periodId: "?", ok: false, errors: ["No period sheets found (expected sheets named YYYY-MM like 2026-04)"], warnings: [], rowCount: 0 }]);
          setValidationDone(true);
          setAllValid(false);
          setBhStep("idle");
          return;
        }
        const results = [];
        const allBills = [];
        let prevState = null; // Map of wingFlat → closing state
        let allOk = true;
        for (let si = 0; si < periodSheets.length; si++) {
          const sheetName = periodSheets[si];
          const rows = sheetToRows(wb.getWorksheet(sheetName));
          const result = validateBillHistorySheet(rows, sheetName, prevState, interestRate || 21);
          results.push({ periodId: sheetName, ...result, rowCount: rows.length });
          prevState = result.closingState;
          if (!result.ok) allOk = false;
          // Collect bills from this sheet
          for (const row of rows) {
            const wingFlat = String(row["Wing-FlatNo"] || "").trim();
            if (!wingFlat || wingFlat.startsWith("⚠")) continue;
            allBills.push({ periodId: sheetName, wingFlat, ...row });
          }
        }
        setSheetResults(results);
        setValidationDone(true);
        setAllValid(allOk);
        setValidatedBills(allOk ? allBills : null);
        setBhStep("idle");
      } catch (err) {
        setSheetResults([{ periodId: "?", ok: false, errors: [`Could not parse file: ${err.message}`], warnings: [], rowCount: 0 }]);
        setValidationDone(true);
        setAllValid(false);
        setBhStep("idle");
      }
    };
    reader.readAsArrayBuffer(file);
  };
  const handleSave = async () => {
    if (!validatedBills?.length) return;
    setBhStep("saving");
    setSaveError(null);
    try {
      const res = await fetch("/api/superadmin/bill-history-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ societyId, bills: validatedBills, joinPeriodId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setSaveResult(data);
      setBhStep("done");
      if (onComplete) onComplete(data);
    } catch (err) {
      setSaveError(err.message);
      setBhStep("error");
    }
  };
  const totalErrors = sheetResults.reduce((s, r) => s + r.errors.length, 0);
  const totalWarnings = sheetResults.reduce((s, r) => s + r.warnings.length, 0);
  return (
    <div style={{ padding: "0.5rem 0" }}>
      <h3 style={{ margin: "0 0 0.4rem", color: "#a5b4fc", fontSize: "1rem" }}>
        Step 4: Bill History Import
      </h3>
      <p style={{ color: "#9ca3af", fontSize: "0.82rem", margin: "0 0 1.25rem" }}>
        Import all historical bills from prev April to the month before they joined. Required for accurate opening balance and audit trail.
      </p>
      {/* Template download */}
      {bhStep !== "done" && (
        <div style={{ background: "#1e1b4b", borderRadius: 8, padding: "1rem", marginBottom: "1.25rem" }}>
          <div style={{ fontSize: "0.82rem", color: "#c7d2fe", marginBottom: "0.5rem" }}>
            First, download the pre-filled template for <strong>{societyName}</strong> (all members, all months from prev April to {joinPeriodId}):
          </div>
          <button
            onClick={async () => {
              const res = await fetch(
                `/api/superadmin/bill-history-template?societyId=${societyId}&joinPeriod=${joinPeriodId}`,
                { credentials: "include" }
              );
              if (!res.ok) { alert("Template download failed"); return; }
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `BillHistory_${societyName.replace(/\s/g, "_")}.xlsx`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            style={{ background: "#4f46e5", color: "#fff", border: "none", padding: "0.5rem 1.2rem", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: "0.85rem" }}
          >
            ⬇️ Download Bill History Template
          </button>
        </div>
      )}
      {bhStep === "done" && saveResult ? (
        <div style={{ background: "#064e3b", borderRadius: 8, padding: "1.25rem" }}>
          <div style={{ color: "#4ade80", fontWeight: 700, fontSize: "1rem", marginBottom: "0.5rem" }}>✅ Bill History Saved</div>
          <div style={{ fontSize: "0.85rem", color: "#a7f3d0", lineHeight: 1.8 }}>
            <div><strong>Bills created:</strong> {saveResult.created}</div>
            <div><strong>Periods covered:</strong> {saveResult.periods?.join(", ")}</div>
            {saveResult.errors > 0 && <div style={{ color: "#fbbf24" }}><strong>Errors:</strong> {saveResult.errors} rows failed — check data</div>}
          </div>
          <button
            onClick={() => onComplete && onComplete(saveResult)}
            style={{ marginTop: "1rem", background: "#059669", color: "#fff", border: "none", padding: "0.6rem 1.5rem", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}
          >
            Continue →
          </button>
        </div>
      ) : (
        <>
          {/* Upload */}
          {bhStep !== "saving" && (
            <DropZone
              accept=".xlsx,.xls"
              file={bhFile}
              onFile={handleFileChange}
              onClear={() => { setBhFile(null); setSheetResults([]); setValidationDone(false); setAllValid(false); setValidatedBills(null); }}
              label="Upload filled Bill History Excel"
              hint=".xlsx — must have sheets named YYYY-MM"
              style={{ marginBottom: "1.25rem" }}
            />
          )}
          {bhStep === "validating" && (
            <div style={{ padding: "1rem", textAlign: "center", color: "#a5b4fc" }}>Validating all sheets...</div>
          )}
          {bhStep === "saving" && (
            <div style={{ padding: "1rem", textAlign: "center", color: "#a5b4fc" }}>Saving to database...</div>
          )}
          {bhStep === "error" && saveError && (
            <div style={{ background: "#450a0a", borderRadius: 8, padding: "1rem", marginBottom: "1rem" }}>
              <div style={{ color: "#fca5a5", fontWeight: 600 }}>Save Failed</div>
              <div style={{ color: "#fca5a5", fontSize: "0.82rem", marginTop: 4 }}>{saveError}</div>
            </div>
          )}
          {/* Sheet results */}
          {validationDone && sheetResults.length > 0 && (
            <div style={{ marginBottom: "1.25rem" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.6rem" }}>
                Validation Results — {sheetResults.length} months
              </div>
              {/* Summary bar */}
              <div style={{ display: "flex", gap: "1rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
                <span style={{ background: "#064e3b", border: "1px solid #10b981", borderRadius: 6, padding: "3px 10px", fontSize: "0.75rem", color: "#4ade80", fontWeight: 700 }}>
                  ✓ {sheetResults.filter(r => r.ok).length} passed
                </span>
                {totalErrors > 0 && (
                  <span style={{ background: "#450a0a", border: "1px solid #dc2626", borderRadius: 6, padding: "3px 10px", fontSize: "0.75rem", color: "#f87171", fontWeight: 700 }}>
                    ✕ {sheetResults.filter(r => !r.ok).length} failed · {totalErrors} errors
                  </span>
                )}
                {totalWarnings > 0 && (
                  <span style={{ background: "#451a03", border: "1px solid #d97706", borderRadius: 6, padding: "3px 10px", fontSize: "0.75rem", color: "#fbbf24", fontWeight: 700 }}>
                    ⚠ {totalWarnings} warnings
                  </span>
                )}
              </div>
              {/* Sheet list — timeline style */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                {sheetResults.map((r, i) => (
                  <div key={r.periodId}>
                    <div
                      onClick={() => setActiveSheetIdx(activeSheetIdx === i ? null : i)}
                      style={{
                        display: "flex", alignItems: "center", gap: "0.75rem",
                        padding: "0.5rem 0.75rem", borderRadius: 6, cursor: "pointer",
                        background: r.ok ? "#064e3b22" : "#450a0a22",
                        border: `1px solid ${r.ok ? "#10b981" : "#dc2626"}`,
                        transition: "all 0.2s",
                      }}
                    >
                      <div style={{ fontSize: "1.1rem" }}>{r.ok ? "✓" : "✕"}</div>
                      <div style={{ flex: 1 }}>
                        <span style={{ color: r.ok ? "#4ade80" : "#f87171", fontWeight: 700, fontSize: "0.85rem" }}>{r.periodId}</span>
                        <span style={{ color: "#6b7280", fontSize: "0.72rem", marginLeft: 8 }}>{r.rowCount} rows</span>
                      </div>
                      {r.errors.length > 0 && (
                        <span style={{ color: "#f87171", fontSize: "0.72rem" }}>{r.errors.length} error{r.errors.length > 1 ? "s" : ""}</span>
                      )}
                      {r.warnings.length > 0 && (
                        <span style={{ color: "#fbbf24", fontSize: "0.72rem" }}>{r.warnings.length} warning{r.warnings.length > 1 ? "s" : ""}</span>
                      )}
                      <span style={{ color: "#4b5563", fontSize: "0.7rem" }}>{activeSheetIdx === i ? "▲" : "▼"}</span>
                    </div>
                    {/* Expanded error detail */}
                    {activeSheetIdx === i && (r.errors.length > 0 || r.warnings.length > 0) && (
                      <div style={{ background: "#111827", borderRadius: "0 0 6px 6px", padding: "0.75rem", marginTop: -1, border: "1px solid #374151", borderTop: "none" }}>
                        {r.errors.map((e, ei) => (
                          <div key={ei} style={{ fontSize: "0.75rem", color: "#f87171", marginBottom: 4, display: "flex", gap: "0.4rem" }}>
                            <span>✕</span><span>{e}</span>
                          </div>
                        ))}
                        {r.warnings.map((w, wi) => (
                          <div key={wi} style={{ fontSize: "0.75rem", color: "#fbbf24", marginBottom: 4, display: "flex", gap: "0.4rem" }}>
                            <span>⚠</span><span>{w}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Actions */}
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.75rem" }}>
            {allValid && validatedBills && bhStep !== "saving" && (
              <button
                onClick={handleSave}
                style={{ flex: 1, background: "#059669", color: "#fff", border: "none", padding: "0.75rem", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: "0.9rem" }}
              >
                ✅ All Valid — Save {validatedBills.length} Bill Records
              </button>
            )}
            <button
              onClick={onSkip}
              style={{ background: "#374151", color: "#9ca3af", border: "none", padding: "0.75rem 1.25rem", borderRadius: 8, cursor: "pointer", fontSize: "0.85rem" }}
            >
              Skip (do later)
            </button>
          </div>
        </>
      )}
    </div>
  );
}
// Auto-detects joinPeriodId from first bill, then renders BillHistoryStep
function BhModal({ society, onClose }) {
  const [joinPeriodId, setJoinPeriodId] = useState(society.onboarding?.joinPeriodId || null);
  const [loading, setLoading] = useState(!society.onboarding?.joinPeriodId);
  const [noBills, setNoBills] = useState(false);
  // Auto-fetch if not already stored
  useEffect(() => {
    if (joinPeriodId) { setLoading(false); return; }
    (async () => {
      try {
        const res = await fetch(
          `/api/superadmin/bill-history-import?societyId=${society._id}`,
          { credentials: "include" }
        );
        const data = await res.json();
        if (data.joinPeriodId) {
          setJoinPeriodId(data.joinPeriodId);
        } else {
          setNoBills(true);
        }
      } catch {
        setNoBills(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        style={{ background: "#111827", border: "1px solid #374151", borderRadius: 12, padding: "2rem", width: 640, maxHeight: "90vh", overflowY: "auto", color: "#f0f0f0" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
          <div>
            <h2 style={{ margin: 0, color: "#a5b4fc", fontSize: "1.1rem" }}>📜 Bill History Import</h2>
            <div style={{ color: "#6b7280", fontSize: "0.82rem", marginTop: 2 }}>{society.name}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#9ca3af", fontSize: "1.3rem", cursor: "pointer" }}>✕</button>
        </div>
        {loading && (
          <div style={{ padding: "2rem", textAlign: "center", color: "#6b7280", fontSize: "0.85rem" }}>
            Detecting join period from bills...
          </div>
        )}
        {!loading && noBills && (
          <div style={{ background: "#1c1400", border: "1px solid #92400e", borderRadius: 8, padding: "1rem" }}>
            <div style={{ color: "#fbbf24", fontWeight: 600, marginBottom: "0.4rem" }}>No bills found</div>
            <div style={{ color: "#fde68a", fontSize: "0.82rem" }}>
              This society has no bills generated yet. Generate at least one bill first — the system uses the first bill's period as the join month.
            </div>
          </div>
        )}
        {!loading && joinPeriodId && (
          <>
            <div style={{ background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 6, padding: "0.6rem 1rem", marginBottom: "1.25rem", fontSize: "0.8rem", color: "#60a5fa" }}>
              Join period auto-detected: <strong>{joinPeriodId}</strong> (first bill month)
            </div>
            <BillHistoryStep
              societyId={society._id}
              societyName={society.name}
              joinPeriodId={joinPeriodId}
              interestRate={society.config?.interestRate || 21}
              onComplete={onClose}
              onSkip={onClose}
            />
          </>
        )}
      </div>
    </div>
  );
}
export default function AdminSocietiesPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const queryClient = useQueryClient();
  // Modal state — single society import
  const [showAddModal, setShowAddModal] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null); // file object for DropZone display
  const [parsedRows, setParsedRows] = useState(null); // raw parsed rows
  const [validationErrors, setValidationErrors] = useState([]); // [{row, field}]
  const [uploadLoading, setUploadLoading] = useState(false);
  const [creationResults, setCreationResults] = useState(null); // [{societyName, email, password, error}]
  const [creationProgress, setCreationProgress] = useState({
    current: 0,
    total: 0,
  });
  // View Credentials dialog
  const [viewCredsTarget, setViewCredsTarget] = useState(null); // { societyId, name }
  const [viewCreds, setViewCreds] = useState(null); // [{ flatNo, wing, ownerName, username, email }]
  const [viewCredsLoading, setViewCredsLoading] = useState(false);
  // Delete society
  const [deleteTarget, setDeleteTarget] = useState(null); // society object
  // Bulk import modal state
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkStep, setBulkStep] = useState("idle"); // idle | uploading | validation-failed | done | error
  const [bulkAnimStep, setBulkAnimStep] = useState(0); // 0=waiting,1=society,2=members,3=done
  const [bulkResult, setBulkResult] = useState(null);
  const [bulkValidation, setBulkValidation] = useState(null); // { phase, errors, warnings }
  const [bulkError, setBulkError] = useState(null);
  // Bill history step state (bulk import flow)
  const [showBillHistory, setShowBillHistory] = useState(false);
  const [billHistoryDone, setBillHistoryDone] = useState(false);
  // Standalone bill history modal (from societies table)
  const [bhModalSociety, setBhModalSociety] = useState(null); // society object
  const { data: societiesData, isLoading } = useQuery({
    queryKey: ["admin-societies"],
    queryFn: () => apiClient.get("/api/admin/societies"),
  });
  const societies = societiesData?.societies || [];
  const filteredSocieties = societies.filter((s) => {
    const matchesSearch = s.name
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const matchesStatus =
      filterStatus === "All" || s.subscription?.status === filterStatus;
    return matchesSearch && matchesStatus && !s.isDeleted;
  });
  const updateSubscriptionMutation = useMutation({
    mutationFn: ({ societyId, updates }) =>
      apiClient.put("/api/admin/societies", { societyId, updates }),
    onSuccess: () => {
      alert("✅ Subscription updated");
      queryClient.invalidateQueries(["admin-societies"]);
    },
  });
  const handlePaymentRecord = (society) => {
    const amount = parseFloat(prompt(`Enter payment amount for "${society.name}":`));
    if (!amount || isNaN(amount)) return;
    const method = prompt("Payment method (UPI/Bank/Cash):") || "UPI";
    const nextDateStr = prompt("Next payment due date (YYYY-MM-DD), leave blank to skip:");
    const nextDate = nextDateStr?.trim() ? new Date(nextDateStr.trim()) : null;
    const currentTotal = society.subscription?.amountPaid || 0;
    const updates = {
      "subscription.lastPaymentDate": new Date(),
      "subscription.amountPaid": currentTotal + amount,
      "subscription.status": "Active",
      $push: {
        "subscription.paymentHistory": {
          date: new Date(),
          amount,
          method,
          transactionId: `TXN-${Date.now()}`,
        },
      },
    };
    if (nextDate && !isNaN(nextDate.getTime())) {
      updates["subscription.nextPaymentDate"] = nextDate;
    }
    updateSubscriptionMutation.mutate({ societyId: society._id, updates });
  };
  const suspendSociety = (societyId) => {
    if (!confirm("Suspend this society? They will lose access.")) return;
    updateSubscriptionMutation.mutate({
      societyId,
      updates: { "subscription.status": "Suspended" },
    });
  };
  const activateSociety = (societyId) => {
    updateSubscriptionMutation.mutate({
      societyId,
      updates: { "subscription.status": "Active" },
    });
  };
  // ── Excel Parse & Validate ──
  const handleFileChange = (file) => {
    if (!file) return;
    setUploadedFile(file);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const wb = await loadWorkbookFromArrayBuffer(evt.target.result);
        const rows = sheetToRows(wb.worksheets[0]);
        if (!rows.length) {
          setParsedRows([]);
          setValidationErrors([
            { row: "-", field: "File is empty or has no data rows" },
          ]);
          return;
        }
        const errors = validateRows(rows);
        setParsedRows(rows);
        setValidationErrors(errors);
        setCreationResults(null);
      } catch (err) {
        setValidationErrors([
          { row: "-", field: `Could not parse file: ${err.message}` },
        ]);
        setParsedRows(null);
      }
    };
    reader.readAsArrayBuffer(file);
  };
  // ── Create All Societies ──
  const handleCreateAll = async () => {
    if (!parsedRows?.length || validationErrors.length > 0) return;
    setUploadLoading(true);
    setCreationProgress({ current: 0, total: parsedRows.length });
    const results = [];
    for (let i = 0; i < parsedRows.length; i++) {
      const payload = rowToSocietyPayload(parsedRows[i]);
      setCreationProgress({ current: i + 1, total: parsedRows.length });
      try {
        const res = await fetch("/api/admin/societies/create", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");
        results.push({
          societyName: payload.societyName,
          email: data.adminEmail,
          password: data.plainPassword,
          societyId: data.society?.societyId,
          error: null,
        });
      } catch (err) {
        results.push({
          societyName: payload.societyName,
          email: payload.email,
          password: null,
          societyId: null,
          error: err.message,
        });
      }
      await new Promise((r) => setTimeout(r, 0));
    }
    setCreationResults(results);
    setUploadLoading(false);
    setCreationProgress({ current: 0, total: 0 });
    queryClient.invalidateQueries(["admin-societies"]);
  };
  // Real, server-backed progress → animation step index. Replaces the old
  // fake fixed-duration setTimeout chain, which advanced only after the
  // whole import had already finished (so it never reflected what was
  // actually happening during the 2-4 minute wait).
  const stageToAnimStep = (status) => {
    switch (status) {
      case "VALIDATING":
        return 1;
      case "IMPORTING":
        return 3;
      case "FINALIZING":
        return 4;
      case "COMMITTED":
      case "EMAIL_QUEUED":
      case "COMPLETED":
        return 5;
      default:
        return 0;
    }
  };
  const pollImportStatus = (importRunId, stopRef) => {
    const tick = async () => {
      if (stopRef.stopped) return;
      try {
        const res = await fetch(
          `/api/admin/bulk-import/status?importRunId=${encodeURIComponent(importRunId)}`,
          { credentials: "include" },
        );
        if (res.ok) {
          const data = await res.json();
          setBulkAnimStep(stageToAnimStep(data.status));
        }
      } catch {
        // transient poll failure — the POST response below is still authoritative
      }
      if (!stopRef.stopped) stopRef.timer = setTimeout(tick, 1500);
    };
    tick();
  };
  const handleBulkImport = async () => {
    if (!bulkFile) return;
    // Stable key across a refresh/retry so a duplicate click or a re-submit
    // after a dropped connection replays the same server-side run instead of
    // starting a second import.
    let importRunId = sessionStorage.getItem("bulkImportRunId");
    if (!importRunId) {
      importRunId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem("bulkImportRunId", importRunId);
    }
    setBulkStep("uploading");
    setBulkAnimStep(0);
    setBulkError(null);
    setBulkResult(null);
    setBulkValidation(null);
    const stopRef = { stopped: false, timer: null };
    pollImportStatus(importRunId, stopRef);
    try {
      const fd = new FormData();
      fd.append("file", bulkFile);
      fd.append("importRunId", importRunId);
      const res = await fetch("/api/admin/bulk-import", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = await res.json();
      stopRef.stopped = true;
      clearTimeout(stopRef.timer);
      // Validation failed or rollback — show errors immediately, no animation.
      // The key is cleared so the admin can fix the sheet and retry cleanly.
      if (data.validationFailed || res.status === 409) {
        sessionStorage.removeItem("bulkImportRunId");
        setBulkValidation(data);
        setBulkStep("validation-failed");
        return;
      }
      if (!res.ok) throw new Error(data.error || "Import failed");
      setBulkAnimStep(5);
      setBulkResult(data);
      setBulkStep("done");
      sessionStorage.removeItem("bulkImportRunId");
      queryClient.invalidateQueries(["admin-societies"]);
    } catch (err) {
      stopRef.stopped = true;
      clearTimeout(stopRef.timer);
      sessionStorage.removeItem("bulkImportRunId");
      setBulkError(err.message);
      setBulkStep("error");
    }
  };
  const resetBulkModal = () => {
  setShowBulkModal(false);
};
  const resetModal = () => {
    setShowAddModal(false);
    setUploadedFile(null);
    setParsedRows(null);
    setValidationErrors([]);
    setCreationResults(null);
    setCreationProgress({ current: 0, total: 0 });
  };
  const hasErrors = validationErrors.length > 0;
  const isReady =
    parsedRows && parsedRows.length > 0 && !hasErrors && !creationResults;
  return (
    <div className={styles.adminContainer}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Society Management</h1>
          <p className={styles.pageSubtitle}>
            Total: {societies.length} societies
          </p>
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
            <button
              onClick={() => {
                setShowAddModal(true);
                setUploadedFile(null);
                setParsedRows(null);
                setValidationErrors([]);
                setCreationResults(null);
              }}
              style={{
                background: "#10B981",
                color: "#fff",
                border: "none",
                padding: "0.6rem 1.4rem",
                borderRadius: 6,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              + Add Societies
            </button>
            <button
              onClick={() => setShowBulkModal(true)}
              style={{
                background: "#6366f1",
                color: "#fff",
                border: "none",
                padding: "0.6rem 1.4rem",
                borderRadius: 6,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Bulk Import (Society + Members)
            </button>
          </div>
        </div>
      </div>
      {/* Filters */}
      <div className={styles.filtersBar}>
        <input
          type="text"
          placeholder="🔍 Search societies..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className={styles.searchInput}
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className={styles.filterSelect}
        >
          <option value="All">All Status</option>
          <option value="Active">Active</option>
          <option value="Trial">Trial</option>
          <option value="Suspended">Suspended</option>
          <option value="Expired">Expired</option>
        </select>
      </div>
      {/* Stats */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard} style={{ borderColor: "#10B981" }}>
          <div className={styles.statNumber}>
            {
              societies.filter((s) => s.subscription?.status === "Active")
                .length
            }
          </div>
          <div className={styles.statLabel}>Active</div>
        </div>
        <div className={styles.statCard} style={{ borderColor: "#F59E0B" }}>
          <div className={styles.statNumber}>
            {societies.filter((s) => s.subscription?.status === "Trial").length}
          </div>
          <div className={styles.statLabel}>Trial</div>
        </div>
        <div className={styles.statCard} style={{ borderColor: "#EF4444" }}>
          <div className={styles.statNumber}>
            {
              societies.filter((s) => s.subscription?.status === "Suspended")
                .length
            }
          </div>
          <div className={styles.statLabel}>Suspended</div>
        </div>
        <div className={styles.statCard} style={{ borderColor: "#3B82F6" }}>
          <div className={styles.statNumber}>
            ₹
            {societies
              .reduce((sum, s) => sum + (s.subscription?.amountPaid || 0), 0)
              .toLocaleString()}
          </div>
          <div className={styles.statLabel}>Total Revenue</div>
        </div>
      </div>
      {/* ── SUBSCRIPTION OVERVIEW ── */}
      {!isLoading && (() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const in7 = new Date(today); in7.setDate(today.getDate() + 7);
        const in30 = new Date(today); in30.setDate(today.getDate() + 30);
        const overdue = societies.filter((s) => {
          const d = s.subscription?.nextPaymentDate ? new Date(s.subscription.nextPaymentDate) : null;
          return d && d < today && s.subscription?.status !== "Suspended";
        });
        const dueSoon = societies.filter((s) => {
          const d = s.subscription?.nextPaymentDate ? new Date(s.subscription.nextPaymentDate) : null;
          return d && d >= today && d <= in7;
        });
        const dueIn30 = societies.filter((s) => {
          const d = s.subscription?.nextPaymentDate ? new Date(s.subscription.nextPaymentDate) : null;
          return d && d > in7 && d <= in30;
        });
        const noPayment = societies.filter((s) => !s.subscription?.nextPaymentDate && !s.isDeleted);
        const totalRevenue = societies.reduce((sum, s) => sum + (s.subscription?.amountPaid || 0), 0);
        return (
          <div style={{ marginBottom: "1.5rem" }}>
            {/* Alert rows */}
            {overdue.length > 0 && (
              <div style={{ background: "#1c0a0a", border: "1px solid #991b1b", borderRadius: 8, padding: "1rem 1.25rem", marginBottom: "0.75rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <span style={{ color: "#f87171", fontWeight: 700, fontSize: "0.9rem" }}>🔴 {overdue.length} Overdue Payment{overdue.length > 1 ? "s" : ""}</span>
                  <span style={{ color: "#dc2626", fontSize: "0.8rem", fontWeight: 600 }}>Action required</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                  {overdue.map((s) => (
                    <span key={s._id} style={{ background: "#450a0a", border: "1px solid #7f1d1d", borderRadius: 4, padding: "3px 8px", fontSize: "0.75rem", color: "#fca5a5" }}>
                      {s.name}
                      {s.subscription?.nextPaymentDate && (
                        <span style={{ color: "#f87171", marginLeft: 4 }}>
                          (due {new Date(s.subscription.nextPaymentDate).toLocaleDateString("en-IN")})
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {dueSoon.length > 0 && (
              <div style={{ background: "#1c1400", border: "1px solid #92400e", borderRadius: 8, padding: "1rem 1.25rem", marginBottom: "0.75rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <span style={{ color: "#fbbf24", fontWeight: 700, fontSize: "0.9rem" }}>🟡 {dueSoon.length} Due within 7 days</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                  {dueSoon.map((s) => (
                    <span key={s._id} style={{ background: "#292100", border: "1px solid #78350f", borderRadius: 4, padding: "3px 8px", fontSize: "0.75rem", color: "#fde68a" }}>
                      {s.name} ({new Date(s.subscription.nextPaymentDate).toLocaleDateString("en-IN")})
                    </span>
                  ))}
                </div>
              </div>
            )}
            {/* Summary row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem" }}>
              <div style={{ background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 8, padding: "0.9rem 1rem" }}>
                <div style={{ color: "#60a5fa", fontSize: "0.75rem", fontWeight: 600, marginBottom: 4 }}>Due in 30 days</div>
                <div style={{ color: "#fff", fontSize: "1.3rem", fontWeight: 700 }}>{dueIn30.length}</div>
                <div style={{ color: "#475569", fontSize: "0.72rem", marginTop: 2 }}>societies</div>
              </div>
              <div style={{ background: "#0a1a10", border: "1px solid #065f46", borderRadius: 8, padding: "0.9rem 1rem" }}>
                <div style={{ color: "#34d399", fontSize: "0.75rem", fontWeight: 600, marginBottom: 4 }}>Total Revenue</div>
                <div style={{ color: "#fff", fontSize: "1.3rem", fontWeight: 700 }}>₹{totalRevenue.toLocaleString("en-IN")}</div>
                <div style={{ color: "#475569", fontSize: "0.72rem", marginTop: 2 }}>all time</div>
              </div>
              <div style={{ background: "#1a0a1a", border: "1px solid #6b21a8", borderRadius: 8, padding: "0.9rem 1rem" }}>
                <div style={{ color: "#c084fc", fontSize: "0.75rem", fontWeight: 600, marginBottom: 4 }}>Trial Societies</div>
                <div style={{ color: "#fff", fontSize: "1.3rem", fontWeight: 700 }}>
                  {societies.filter((s) => s.subscription?.status === "Trial").length}
                </div>
                <div style={{ color: "#475569", fontSize: "0.72rem", marginTop: 2 }}>not converted</div>
              </div>
              <div style={{ background: "#1a1a0a", border: "1px solid #92400e", borderRadius: 8, padding: "0.9rem 1rem" }}>
                <div style={{ color: "#fb923c", fontSize: "0.75rem", fontWeight: 600, marginBottom: 4 }}>No Pay Date Set</div>
                <div style={{ color: "#fff", fontSize: "1.3rem", fontWeight: 700 }}>{noPayment.length}</div>
                <div style={{ color: "#475569", fontSize: "0.72rem", marginTop: 2 }}>societies</div>
              </div>
            </div>
          </div>
        );
      })()}
      {/* Table */}
      {isLoading ? (
        <div className={styles.loading}>Loading societies...</div>
      ) : (
        <div className={styles.tableCard}>
          <table className={styles.adminTable}>
            <thead>
              <tr>
                <th>Society Name</th>
                <th>Admin Credentials</th>
                <th>Registration</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Last Payment</th>
                <th>Next Payment</th>
                <th>Total Paid</th>
                <th>Config Ver.</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSocieties.map((society) => (
                <tr key={society._id}>
                  <td>
                    <div className={styles.societyName}>{society.name}</div>
                    <div className={styles.societyId}>{society._id}</div>
                  </td>
                  <td style={{ fontSize: "0.8rem" }}>
                    {society.credentials?.adminEmail ? (
                      <div>
                        <div style={{ color: "#999" }}>
                          {society.credentials.adminEmail}
                        </div>
                        <div
                          style={{
                            fontFamily: "monospace",
                            color: "#4CAF50",
                            fontWeight: 700,
                          }}
                        >
                          {society.credentials.plainPassword || "—"}
                        </div>
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{society.registrationNo || "N/A"}</td>
                  <td>
                    <span className={styles.planBadge}>
                      {society.subscription?.planType || "Free"}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`${styles.statusBadge} ${styles[society.subscription?.status?.toLowerCase()]}`}
                    >
                      {society.subscription?.status || "Trial"}
                    </span>
                  </td>
                  <td>
                    {society.subscription?.lastPaymentDate
                      ? new Date(
                          society.subscription.lastPaymentDate,
                        ).toLocaleDateString("en-IN")
                      : "Never"}
                  </td>
                  <td>
                    {society.subscription?.nextPaymentDate
                      ? new Date(
                          society.subscription.nextPaymentDate,
                        ).toLocaleDateString("en-IN")
                      : "Not set"}
                  </td>
                  <td className={styles.amountCell}>
                    ₹{(society.subscription?.amountPaid || 0).toLocaleString()}
                  </td>
                  <td>v{society.configVersion || 1}</td>
                  <td>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px" }}>
                      <button
                        onClick={() => handlePaymentRecord(society)}
                        style={{ background: "#10B981", color: "#fff", border: "none", borderRadius: 4, fontSize: "0.72rem", padding: "3px 8px", cursor: "pointer" }}
                      >
                        💰 Payment
                      </button>
                      {society.subscription?.status === "Active" ? (
                        <button
                          onClick={() => suspendSociety(society._id)}
                          style={{ background: "#EF4444", color: "#fff", border: "none", borderRadius: 4, fontSize: "0.72rem", padding: "3px 8px", cursor: "pointer" }}
                        >
                          🚫 Suspend
                        </button>
                      ) : (
                        <button
                          onClick={() => activateSociety(society._id)}
                          style={{ background: "#10B981", color: "#fff", border: "none", borderRadius: 4, fontSize: "0.72rem", padding: "3px 8px", cursor: "pointer" }}
                        >
                          ✅ Activate
                        </button>
                      )}
                      <button
                        onClick={() =>
                          window.open(
                            `/superadmin/societies/${society._id}`,
                            "_blank",
                          )
                        }
                        style={{ background: "#3B82F6", color: "#fff", border: "none", borderRadius: 4, fontSize: "0.72rem", padding: "3px 8px", cursor: "pointer" }}
                      >
                        📊 Details
                      </button>
                      <button
                        style={{ background: "#7c3aed", color: "#fff", border: "none", borderRadius: 4, fontSize: "0.72rem", padding: "3px 8px", cursor: "pointer" }}
                        onClick={async () => {
                          if (!window.confirm(`Reset passwords for ALL members of "${society.name}"? They will need new credentials to login.`)) return;
                          const res = await fetch("/api/superadmin/reset-member-passwords", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ societyId: society._id }),
                          });
                          const data = await res.json();
                          if (!res.ok) { alert(data.error || "Failed"); return; }
                          if (!data.credentials?.length) { alert("No member accounts found."); return; }
                          const dlRes = await fetch("/api/members/download-credentials", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ credentials: data.credentials }),
                          });
                          if (!dlRes.ok) { alert("Reset done but download failed"); return; }
                          const blob = await dlRes.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `Member_Credentials_${society.name}_${Date.now()}.xlsx`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        🔑 Reset Creds
                      </button>
                      <button
                        style={{ background: "#b45309", color: "#fff", border: "none", borderRadius: 4, fontSize: "0.72rem", padding: "3px 8px", cursor: "pointer" }}
                        onClick={async () => {
                          const custom = window.prompt(
                            `Reset admin password for "${society.name}".\n\nEnter new password (min 8 chars), or leave blank to auto-generate:`
                          );
                          if (custom === null) return; // cancelled
                          const res = await fetch("/api/superadmin/reset-admin-password", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ societyId: society._id, newPassword: custom || undefined }),
                          });
                          const data = await res.json();
                          if (!res.ok) { alert(data.error || "Failed"); return; }
                          alert(`✅ Admin password reset!\n\nEmail: ${data.adminEmail}\nNew Password: ${data.newPassword}\n\nSave this — it won't be shown again.`);
                          queryClient.invalidateQueries(["admin-societies"]);
                        }}
                      >
                        🔐 Reset Admin Pass
                      </button>
                      <button
                        style={{ background: "#0e7490", color: "#fff", border: "none", borderRadius: 4, fontSize: "0.72rem", padding: "3px 8px", cursor: "pointer" }}
                        onClick={async () => {
                          setViewCredsTarget({ societyId: society._id, name: society.name });
                          setViewCreds(null);
                          setViewCredsLoading(true);
                          try {
                            const res = await fetch(`/api/superadmin/member-credentials?societyId=${society._id}`, {
                              credentials: "include",
                            });
                            const data = await res.json();
                            if (!res.ok) throw new Error(data.error || "Failed");
                            setViewCreds(data.credentials || []);
                          } catch (e) {
                            alert("Failed to load credentials: " + e.message);
                            setViewCredsTarget(null);
                          } finally {
                            setViewCredsLoading(false);
                          }
                        }}
                      >
                        👁 View Creds
                      </button>
                      {!society.onboarding?.billHistoryImported ? (
                        <button
                          style={{ background: "#7c3aed", color: "#fff", border: "none", borderRadius: 4, fontSize: "0.72rem", padding: "3px 8px", cursor: "pointer" }}
                          onClick={() => setBhModalSociety(society)}
                        >
                          📜 Bill History
                        </button>
                      ) : (
                        <button
                          style={{ background: "#064e3b", color: "#4ade80", border: "1px solid #10b981", borderRadius: 4, fontSize: "0.72rem", padding: "3px 8px", cursor: "default" }}
                          disabled
                        >
                          ✓ History Done
                        </button>
                      )}
                      <button
                        style={{ background: "#92400e", color: "#fef3c7", border: "none", borderRadius: 4, fontSize: "0.72rem", padding: "3px 8px", cursor: "pointer" }}
                        onClick={async () => {
                          const joinPeriod = society.onboarding?.joinPeriodId;
                          const confirmMsg = joinPeriod
                            ? `Fix historical bill balances for "${society.name}"?\n\nWill zero out all bills before join period ${joinPeriod} AND all BulkImport bills.\n\nSafe to run multiple times.`
                            : `Fix historical bill balances for "${society.name}"?\n\nNo join period detected — will only fix bills with importedFrom=BulkImport.\n\nTo fix by period too, set joinPeriodId first via Bill History Import.`;
                          if (!confirm(confirmMsg)) return;
                          const body = { societyId: society._id };
                          if (joinPeriod) body.beforePeriodId = joinPeriod;
                          const res = await fetch("/api/superadmin/fix-history-bills", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify(body),
                          });
                          const data = await res.json();
                          if (!res.ok) { alert(data.error || "Failed"); return; }
                          alert(`✅ ${data.message}`);
                        }}
                      >
                        🔧 Fix History Bills
                      </button>
                      <button
                        style={{ background: "#7f1d1d", color: "#fff", border: "none", borderRadius: 4, fontSize: "0.72rem", padding: "3px 8px", cursor: "pointer" }}
                        onClick={() => setDeleteTarget(society)}
                      >
                        🗑 Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredSocieties.length === 0 && (
            <div className={styles.emptyState}>
              No societies found matching your filters
            </div>
          )}
        </div>
      )}
      {/* ── ADD SOCIETY MODAL ── */}
      {showAddModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={resetModal}
        >
          <div
            style={{
              background: "#f4f4f4",
              borderRadius: 12,
              padding: "2rem",
              width: 700,
              maxHeight: "90vh",
              overflowY: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* ── CREDENTIALS RESULT SCREEN ── */}
            {creationResults ? (
              <>
                <h2 style={{ color: "#10B981", marginBottom: "0.5rem" }}>
                  ✅ {creationResults.filter((r) => !r.error).length} of{" "}
                  {creationResults.length} Societies Created
                </h2>
                <p
                  style={{
                    color: "#dc2626",
                    fontSize: "0.82rem",
                    marginBottom: "1rem",
                  }}
                >
                  ⚠️ Save these credentials now — passwords will not be shown
                  again.
                </p>
                <div style={{ overflowX: "auto", marginBottom: "1rem" }}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: "0.82rem",
                    }}
                  >
                    <thead>
                      <tr style={{ background: "#111" }}>
                        <th
                          style={{
                            padding: "8px 10px",
                            textAlign: "left",
                            color: "#888",
                            borderBottom: "1px solid #333",
                          }}
                        >
                          Society
                        </th>
                        <th
                          style={{
                            padding: "8px 10px",
                            textAlign: "left",
                            color: "#888",
                            borderBottom: "1px solid #333",
                          }}
                        >
                          Admin Email
                        </th>
                        <th
                          style={{
                            padding: "8px 10px",
                            textAlign: "left",
                            color: "#888",
                            borderBottom: "1px solid #333",
                          }}
                        >
                          Password
                        </th>
                        <th
                          style={{
                            padding: "8px 10px",
                            textAlign: "left",
                            color: "#888",
                            borderBottom: "1px solid #333",
                          }}
                        >
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {creationResults.map((r, i) => (
                        <tr
                          key={i}
                          style={{
                            background: i % 2 === 0 ? "#1e1e1e" : "#222",
                          }}
                        >
                          <td
                            style={{
                              padding: "8px 10px",
                              color: "#fff",
                              borderBottom: "1px solid #2a2a2a",
                            }}
                          >
                            {r.societyName}
                          </td>
                          <td
                            style={{
                              padding: "8px 10px",
                              color: "#ccc",
                              borderBottom: "1px solid #2a2a2a",
                            }}
                          >
                            {r.email}
                          </td>
                          <td
                            style={{
                              padding: "8px 10px",
                              fontFamily: "monospace",
                              color: r.password ? "#fbbf24" : "#555",
                              fontWeight: 700,
                              borderBottom: "1px solid #2a2a2a",
                            }}
                          >
                            {r.password || "—"}
                          </td>
                          <td
                            style={{
                              padding: "8px 10px",
                              borderBottom: "1px solid #2a2a2a",
                            }}
                          >
                            {r.error ? (
                              <span
                                style={{
                                  color: "#f87171",
                                  fontSize: "0.78rem",
                                }}
                              >
                                ❌ {r.error}
                              </span>
                            ) : (
                              <span style={{ color: "#34d399" }}>
                                ✅ Created
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    onClick={() => {
                      // Download credentials as CSV
                      const csv = [
                        [
                          "Society Name",
                          "Admin Email",
                          "Password",
                          "Society ID",
                          "Status",
                        ],
                        ...creationResults.map((r) => [
                          r.societyName,
                          r.email,
                          r.password || "",
                          r.societyId || "",
                          r.error || "Created",
                        ]),
                      ]
                        .map((row) => row.map((v) => `"${v}"`).join(","))
                        .join("\n");
                      const blob = new Blob([csv], { type: "text/csv" });
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = `society_credentials_${Date.now()}.csv`;
                      a.click();
                    }}
                    style={{
                      background: "#2563eb",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "0.5rem 1.2rem",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    ⬇️ Download Credentials CSV
                  </button>
                  <button
                    onClick={resetModal}
                    style={{
                      background: "#374151",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "0.5rem 1.2rem",
                      cursor: "pointer",
                    }}
                  >
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2
                  style={{
                    color: "#000000",
                    marginBottom: "0.25rem",
                    fontSize: "1.1rem",
                  }}
                >
                  📥 Add Societies via Excel
                </h2>
                <p
                  style={{
                    color: "#666",
                    fontSize: "0.82rem",
                    marginBottom: "1.5rem",
                  }}
                >
                  Download the template, fill in society data, upload and fix
                  any errors, then create.
                </p>
                {/* Step 1 — Download Template */}
                <div
                  style={{
                    background: "#f1f1f1",
                    border: "1px solid #454545",
                    borderRadius: 8,
                    padding: "1rem 1.2rem",
                    marginBottom: "1rem",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          color: "#111",
                          fontWeight: 600,
                          fontSize: "0.9rem",
                          marginBottom: 3,
                        }}
                      >
                        1. Download Template
                      </div>
                      <div style={{ color: "#666", fontSize: "0.78rem" }}>
                        25 columns — society info, admin credentials, billing
                        config, charge rates
                      </div>
                    </div>
                    <button
                      onClick={downloadTemplate}
                      style={{
                        background: "#2563eb",
                        color: "#fff",
                        border: "none",
                        padding: "8px 16px",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontWeight: 600,
                        fontSize: "0.85rem",
                        whiteSpace: "nowrap",
                      }}
                    >
                      ⬇️ Download .xlsx
                    </button>
                  </div>
                </div>
                {/* Step 2 — Upload */}
                <div
                  style={{
                    background: "#f1f1f1",
                    border: "1px solid #454545",
                    borderRadius: 8,
                    padding: "1rem 1.2rem",
                    marginBottom: "1rem",
                  }}
                >
                  <div
                    style={{
                      color: "#111",
                      fontWeight: 600,
                      fontSize: "0.9rem",
                      marginBottom: 8,
                    }}
                  >
                    2. Upload Filled Template
                  </div>
                  <DropZone
                    accept=".xlsx,.xls"
                    file={uploadedFile}
                    onFile={handleFileChange}
                    onClear={() => {
                      setUploadedFile(null);
                      setParsedRows(null);
                      setValidationErrors([]);
                    }}
                    label="Click or drag & drop Society Excel here"
                    hint=".xlsx or .xls"
                    style={{ marginTop: 6 }}
                  />
                  {parsedRows && (
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: "0.78rem",
                        color: "#888",
                      }}
                    >
                      Parsed{" "}
                      <strong style={{ color: "#fff" }}>
                        {parsedRows.length}
                      </strong>{" "}
                      rows
                    </div>
                  )}
                </div>
                {/* Validation Results */}
                {parsedRows && (
                  <div style={{ marginBottom: "1rem" }}>
                    {hasErrors ? (
                      <div
                        style={{
                          background: "#1a0a0a",
                          border: "1px solid #7f1d1d",
                          borderRadius: 8,
                          padding: "1rem",
                        }}
                      >
                        <div
                          style={{
                            color: "#f87171",
                            fontWeight: 700,
                            marginBottom: 8,
                            fontSize: "0.9rem",
                          }}
                        >
                          ❌ {validationErrors.length} Error
                          {validationErrors.length > 1 ? "s" : ""} Found — Fix
                          before uploading
                        </div>
                        <div style={{ maxHeight: 220, overflowY: "auto" }}>
                          <table
                            style={{
                              width: "100%",
                              borderCollapse: "collapse",
                              fontSize: "0.78rem",
                            }}
                          >
                            <thead>
                              <tr>
                                <th
                                  style={{
                                    padding: "4px 8px",
                                    textAlign: "left",
                                    color: "#888",
                                    borderBottom: "1px solid #3a1a1a",
                                    width: 60,
                                  }}
                                >
                                  Row
                                </th>
                                <th
                                  style={{
                                    padding: "4px 8px",
                                    textAlign: "left",
                                    color: "#888",
                                    borderBottom: "1px solid #3a1a1a",
                                  }}
                                >
                                  Issue
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {validationErrors.map((err, i) => (
                                <tr key={i}>
                                  <td
                                    style={{
                                      padding: "4px 8px",
                                      color: "#f87171",
                                      borderBottom: "1px solid #2a0a0a",
                                      fontWeight: 700,
                                    }}
                                  >
                                    Row {err.row}
                                  </td>
                                  <td
                                    style={{
                                      padding: "4px 8px",
                                      color: "#fca5a5",
                                      borderBottom: "1px solid #2a0a0a",
                                    }}
                                  >
                                    {err.field}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div
                        style={{
                          background: "#0a1a0f",
                          border: "1px solid #065f46",
                          borderRadius: 8,
                          padding: "1rem",
                        }}
                      >
                        <div
                          style={{
                            color: "#34d399",
                            fontWeight: 700,
                            marginBottom: 6,
                            fontSize: "0.9rem",
                          }}
                        >
                          ✅ All {parsedRows.length}{" "}
                          {parsedRows.length === 1 ? "society" : "societies"}{" "}
                          passed validation
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: "1.5rem",
                            fontSize: "0.78rem",
                            color: "#6ee7b7",
                          }}
                        >
                          <span>✔ Required fields present</span>
                          <span>✔ No duplicate emails/names</span>
                          <span>✔ All formats valid</span>
                          <span>✔ Charge amounts are numeric</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {/* Preview table */}
                {isReady && (
                  <div
                    style={{
                      marginBottom: "1rem",
                      maxHeight: 180,
                      overflowY: "auto",
                      border: "1px solid #2a2a2a",
                      borderRadius: 8,
                    }}
                  >
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: "0.78rem",
                      }}
                    >
                      <thead
                        style={{
                          position: "sticky",
                          top: 0,
                          background: "#111",
                        }}
                      >
                        <tr>
                          <th
                            style={{
                              padding: "6px 10px",
                              textAlign: "left",
                              color: "#888",
                              borderBottom: "1px solid #333",
                            }}
                          >
                            #
                          </th>
                          <th
                            style={{
                              padding: "6px 10px",
                              textAlign: "left",
                              color: "#888",
                              borderBottom: "1px solid #333",
                            }}
                          >
                            Society
                          </th>
                          <th
                            style={{
                              padding: "6px 10px",
                              textAlign: "left",
                              color: "#888",
                              borderBottom: "1px solid #333",
                            }}
                          >
                            Admin Email
                          </th>
                          <th
                            style={{
                              padding: "6px 10px",
                              textAlign: "left",
                              color: "#888",
                              borderBottom: "1px solid #333",
                            }}
                          >
                            Interest
                          </th>
                          <th
                            style={{
                              padding: "6px 10px",
                              textAlign: "left",
                              color: "#888",
                              borderBottom: "1px solid #333",
                            }}
                          >
                            Charges
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsedRows.map((row, i) => {
                          const chargeCount = [
                            row["Maintenance Rate (Per Sq Ft)"],
                            row["Sinking Fund Rate (Per Sq Ft)"],
                            row["Repair Fund Rate (Per Sq Ft)"],
                            row["Water Charges (Fixed)"],
                            row["Security Charges (Fixed)"],
                            row["Electricity Charges (Fixed)"],
                          ].filter((v) => v !== "" && parseFloat(v) > 0).length;
                          return (
                            <tr
                              key={i}
                              style={{
                                background: i % 2 === 0 ? "#1e1e1e" : "#222",
                              }}
                            >
                              <td
                                style={{
                                  padding: "5px 10px",
                                  color: "#666",
                                  borderBottom: "1px solid #2a2a2a",
                                }}
                              >
                                {i + 1}
                              </td>
                              <td
                                style={{
                                  padding: "5px 10px",
                                  color: "#fff",
                                  borderBottom: "1px solid #2a2a2a",
                                  fontWeight: 600,
                                }}
                              >
                                {row["Society Name"]}
                              </td>
                              <td
                                style={{
                                  padding: "5px 10px",
                                  color: "#ccc",
                                  borderBottom: "1px solid #2a2a2a",
                                }}
                              >
                                {row["Admin Email"]}
                              </td>
                              <td
                                style={{
                                  padding: "5px 10px",
                                  color: "#a78bfa",
                                  borderBottom: "1px solid #2a2a2a",
                                }}
                              >
                                21%
                              </td>
                              <td
                                style={{
                                  padding: "5px 10px",
                                  color: "#6ee7b7",
                                  borderBottom: "1px solid #2a2a2a",
                                }}
                              >
                                {chargeCount} heads set
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {/* Progress bar during creation */}
                {uploadLoading && (
                  <div style={{ marginBottom: "1rem" }}>
                    <div
                      style={{
                        color: "#aaa",
                        fontSize: "0.82rem",
                        marginBottom: 6,
                      }}
                    >
                      Creating societies... {creationProgress.current}/
                      {creationProgress.total}
                    </div>
                    <div
                      style={{ height: 6, background: "#333", borderRadius: 4 }}
                    >
                      <div
                        style={{
                          height: "100%",
                          borderRadius: 4,
                          background: "#10B981",
                          width: `${creationProgress.total ? (creationProgress.current / creationProgress.total) * 100 : 0}%`,
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                  </div>
                )}
                {/* Footer buttons */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: "0.5rem",
                  }}
                >
                  <button
                    onClick={resetModal}
                    style={{
                      background: "#374151",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "0.5rem 1.2rem",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateAll}
                    disabled={!isReady || uploadLoading}
                    style={{
                      background:
                        isReady && !uploadLoading ? "#10B981" : "#040404",
                      color: isReady && !uploadLoading ? "#fff" : "#f2f2f2",
                      border: "none",
                      borderRadius: 6,
                      padding: "0.5rem 1.6rem",
                      cursor:
                        isReady && !uploadLoading ? "pointer" : "not-allowed",
                      fontWeight: 600,
                      fontSize: "0.95rem",
                    }}
                  >
                    {uploadLoading
                      ? `Creating ${creationProgress.current}/${creationProgress.total}...`
                      : isReady
                        ? `✅ Create ${parsedRows.length} ${parsedRows.length === 1 ? "Society" : "Societies"}`
                        : "Fix errors to continue"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {/* ── BULK IMPORT WIZARD (upload a filled .xlsx template) ── */}
<BulkImportWizard
  open={showBulkModal}
  onClose={resetBulkModal}
  onImported={() => queryClient.invalidateQueries({ queryKey: ["admin-societies"] })}
  BillHistoryStep={BillHistoryStep}
/>
      {/* ── VIEW CREDENTIALS DIALOG ── */}
      {viewCredsTarget && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => { setViewCredsTarget(null); setViewCreds(null); }}
        >
          <div
            style={{ background: "#0f172a", border: "1px solid #1e40af", borderRadius: 12, padding: "2rem", width: 680, maxHeight: "85vh", display: "flex", flexDirection: "column", color: "#f0f0f0" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <div>
                <h2 style={{ margin: 0, color: "#60a5fa", fontSize: "1.1rem" }}>👁 Member Credentials</h2>
                <div style={{ color: "#6b7280", fontSize: "0.82rem", marginTop: 2 }}>{viewCredsTarget.name}</div>
              </div>
              <button onClick={() => { setViewCredsTarget(null); setViewCreds(null); }} style={{ background: "none", border: "none", color: "#9ca3af", fontSize: "1.3rem", cursor: "pointer" }}>✕</button>
            </div>
            {viewCredsLoading ? (
              <div style={{ textAlign: "center", padding: "2rem", color: "#6b7280" }}>Loading credentials...</div>
            ) : viewCreds?.length === 0 ? (
              <div style={{ textAlign: "center", padding: "2rem", color: "#6b7280" }}>No member accounts found for this society.</div>
            ) : (
              <div style={{ overflowY: "auto", flex: 1 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                  <thead style={{ position: "sticky", top: 0, background: "#0f172a" }}>
                    <tr>
                      {["Flat", "Wing", "Owner", "Username", "Email", "Status"].map((h) => (
                        <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#475569", borderBottom: "1px solid #1e293b", fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(viewCreds || []).map((c, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? "#111827" : "#0f172a" }}>
                        <td style={{ padding: "7px 10px", color: "#f1f5f9", borderBottom: "1px solid #1e293b", fontWeight: 600 }}>{c.flatNo}</td>
                        <td style={{ padding: "7px 10px", color: "#cbd5e1", borderBottom: "1px solid #1e293b" }}>{c.wing || "—"}</td>
                        <td style={{ padding: "7px 10px", color: "#e2e8f0", borderBottom: "1px solid #1e293b" }}>{c.ownerName}</td>
                        <td style={{ padding: "7px 10px", fontFamily: "monospace", color: c.username ? "#a78bfa" : "#4b5563", borderBottom: "1px solid #1e293b" }}>
                          {c.username ? c.username.toUpperCase() : "—"}
                        </td>
                        <td style={{ padding: "7px 10px", color: "#94a3b8", borderBottom: "1px solid #1e293b" }}>{c.email}</td>
                        <td style={{ padding: "7px 10px", borderBottom: "1px solid #1e293b" }}>
                          {!c.hasAccount ? (
                            <span style={{ color: "#6b7280", fontSize: "0.75rem" }}>No account</span>
                          ) : c.isActive ? (
                            <span style={{ color: "#34d399", fontSize: "0.75rem" }}>● Active</span>
                          ) : (
                            <span style={{ color: "#f59e0b", fontSize: "0.75rem" }}>○ Inactive</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.25rem", justifyContent: "flex-end" }}>
              {viewCreds?.length > 0 && (
                <button
                  onClick={async () => {
                    const dlRes = await fetch("/api/members/download-credentials", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      credentials: "include",
                      body: JSON.stringify({ credentials: viewCreds.map((c) => ({ ...c, password: "(not reset)", isNewUser: false })) }),
                    });
                    if (!dlRes.ok) { alert("Download failed"); return; }
                    const blob = await dlRes.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `Member_Credentials_${viewCredsTarget.name}_${Date.now()}.xlsx`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  style={{ background: "#1d4ed8", color: "#fff", border: "none", padding: "0.5rem 1.2rem", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: "0.85rem" }}
                >
                  ⬇️ Export as Excel
                </button>
              )}
              <button
                onClick={() => { setViewCredsTarget(null); setViewCreds(null); }}
                style={{ background: "#374151", color: "#fff", border: "none", padding: "0.5rem 1.2rem", borderRadius: 6, cursor: "pointer" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── DELETE SOCIETY DIALOG ── */}
      {deleteTarget && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setDeleteTarget(null)}
        >
          <div
            style={{ background: "#1c0a0a", border: "2px solid #991b1b", borderRadius: 12, padding: "2rem", width: 480, color: "#f0f0f0" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>⚠️</div>
            <h2 style={{ margin: "0 0 0.5rem", color: "#f87171", fontSize: "1.1rem" }}>Delete Society — Irreversible</h2>
            <p style={{ color: "#fca5a5", fontSize: "0.87rem", marginBottom: "1rem", lineHeight: 1.6 }}>
              This will permanently delete <strong style={{ color: "#fff" }}>{deleteTarget.name}</strong> and ALL associated data:
              members, bills, receipts, transactions, billing heads, and user accounts.
            </p>
            <div style={{ background: "#450a0a", borderRadius: 6, padding: "0.75rem 1rem", marginBottom: "1.25rem", fontSize: "0.82rem", color: "#fca5a5" }}>
              This action cannot be undone. The society and all its data will be gone forever.
            </div>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
              <button
                onClick={() => setDeleteTarget(null)}
                style={{ background: "#374151", color: "#fff", border: "none", padding: "0.6rem 1.4rem", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const res = await fetch("/api/superadmin/delete-society", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ societyId: deleteTarget._id }),
                  });
                  const data = await res.json();
                  if (!res.ok) { alert(data.error || "Delete failed"); return; }
                  alert(`✅ "${data.societyName}" deleted.\nMembers: ${data.deleted.members}, Bills: ${data.deleted.bills}, Receipts: ${data.deleted.receipts}`);
                  setDeleteTarget(null);
                  queryClient.invalidateQueries(["admin-societies"]);
                }}
                style={{ background: "#dc2626", color: "#fff", border: "none", padding: "0.6rem 1.4rem", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}
              >
                🗑 Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── STANDALONE BILL HISTORY MODAL (from table button) ── */}
      {bhModalSociety && (
        <BhModal
          society={bhModalSociety}
          onClose={() => { setBhModalSociety(null); queryClient.invalidateQueries(["admin-societies"]); }}
        />
      )}
    </div>
  );
}

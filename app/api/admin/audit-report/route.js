import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import BillingHead from "@/models/BillingHead";
import Society from "@/models/Society";
import AuditReport from "@/models/AuditReport";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { parseFirstSheet } from "@/lib/excelParse";
import { authorize, authorizeAny } from "@/lib/rbac/authorize";
// ─── Indian FY helpers ────────────────────────────────────────────────────────
/**
 * Given a join month (1-12) and join year, returns the required audit window.
 * Indian FY: April (4) → March (3).
 *
 * Examples:
 *   join April 2026  → April 2025 to March 2026  (12 months, full prev FY)
 *   join June 2026   → April 2025 to May 2026    (14 months, prev FY + current FY up to n-1)
 *   join January 2027→ April 2025 to December 2026 (21 months)
 */
function getAuditWindow(joinMonth, joinYear) {
  // Determine which financial year the joining month belongs to
  // FY 2026-27 = April 2026 to March 2027
  const joinFY = joinMonth >= 4 ? joinYear : joinYear - 1;
  // Required period starts from April of the PREVIOUS FY
  const fromMonth = 4;
  const fromYear = joinFY - 1; // April of prev FY
  // Required period ends at month BEFORE joining (n-1)
  let toMonth = joinMonth - 1;
  let toYear = joinYear;
  if (toMonth < 1) {
    toMonth = 12;
    toYear -= 1;
  }
  // Calculate total months
  const totalMonths = (toYear - fromYear) * 12 + (toMonth - fromMonth) + 1;
  return { fromMonth, fromYear, toMonth, toYear, totalMonths };
}
/** Returns array of { month, year, periodId } for every month in the window */
function expandWindow(fromMonth, fromYear, toMonth, toYear) {
  const periods = [];
  let m = fromMonth,
    y = fromYear;
  while (y < toYear || (y === toYear && m <= toMonth)) {
    periods.push({
      month: m,
      year: y,
      periodId: `${y}-${String(m).padStart(2, "0")}`,
    });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return periods;
}
// ─── POST /api/admin/audit-report ─────────────────────────────────────────────
// Body: multipart — file (xlsx), joinMonth (number), joinYear (number)
export async function POST(request) {
  const gate = await authorize(request, "audit.report.create");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const formData = await request.formData();
    const file = formData.get("file");
    const joinMonth = parseInt(formData.get("joinMonth"));
    const joinYear = parseInt(formData.get("joinYear"));
    if (!file)
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    if (!joinMonth || !joinYear)
      return NextResponse.json(
        { error: "joinMonth and joinYear are required" },
        { status: 400 },
      );
    if (joinMonth < 1 || joinMonth > 12)
      return NextResponse.json(
        { error: "Invalid joinMonth (1-12)" },
        { status: 400 },
      );
    if (file.size > 20 * 1024 * 1024)
      return NextResponse.json(
        { error: "File too large. Max 20MB." },
        { status: 400 },
      );
    const society = await Society.findById(decoded.societyId).lean();
    if (!society)
      return NextResponse.json({ error: "Society not found" }, { status: 404 });
    // ── 1. Calculate required audit window ──────────────────────────────────
    const win = getAuditWindow(joinMonth, joinYear);
    const requiredPeriods = expandWindow(
      win.fromMonth,
      win.fromYear,
      win.toMonth,
      win.toYear,
    );
    const requiredPeriodIds = new Set(requiredPeriods.map((p) => p.periodId));
    // ── 2. Fetch members & billing heads ────────────────────────────────────
    const [members, heads] = await Promise.all([
      Member.find({ societyId: decoded.societyId, isDeleted: { $ne: true } })
        .select("_id flatNo wing ownerName carpetAreaSqft builtUpAreaSqft")
        .lean(),
      BillingHead.find({
        societyId: decoded.societyId,
        isActive: true,
        isDeleted: false,
      })
        .sort({ order: 1 })
        .lean(),
    ]);
    const memberCount = members.length;
    const expectedTotalRows = memberCount * win.totalMonths;
    const memberMap = {};
    members.forEach((m) => {
      memberMap[m._id.toString()] = m;
    });
    // ── 3. Parse Excel ───────────────────────────────────────────────────────
    const bytes = await file.arrayBuffer();
    const rawRows = await parseFirstSheet(Buffer.from(bytes), { defval: "" });
    const errors = [];
    const warnings = [];
    // ── 4. Column validation ─────────────────────────────────────────────────
    const REQUIRED_COLS = [
      "MemberId",
      "Wing",
      "FlatNo",
      "OwnerName",
      "Month",
      "Year",
      "PreviousBalance",
      "InterestDue",
      "GrandTotal",
    ];
    const excelCols = rawRows.length ? Object.keys(rawRows[0]) : [];
    const colChecks = {};
    const headNames = heads.map((h) => h.headName);
    for (const col of REQUIRED_COLS) {
      colChecks[col] = excelCols.includes(col) ? "pass" : "fail";
      if (!excelCols.includes(col))
        errors.push(`Missing required column: ${col}`);
    }
    for (const head of headNames) {
      colChecks[head] = excelCols.includes(head) ? "pass" : "missing";
    }
    if (errors.length > 0) {
      return NextResponse.json({
        passed: false,
        errors,
        warnings,
        validation: {
          passed: false,
          errors,
          warnings,
          columnChecks: colChecks,
        },
      });
    }
    // ── 5. Row-level validation ──────────────────────────────────────────────
    const dataRows = rawRows.filter(
      (r) => !String(r.MemberId || "").startsWith("//"),
    );
    const foundRows = dataRows.length;
    const seenCombo = new Set();
    const foundPeriods = new Set();
    const billRows = [];
    let amountMismatches = 0;
    let duplicateCount = 0;
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = i + 2;
      const memberId = String(row.MemberId || "").trim();
      const rowMonth = parseInt(row.Month);
      const rowYear = parseInt(row.Year);
      const periodId = `${rowYear}-${String(rowMonth).padStart(2, "0")}`;
      // Member exists?
      if (!memberId || !memberMap[memberId]) {
        errors.push(
          `Row ${rowNum}: MemberId "${memberId}" not found in system`,
        );
        continue;
      }
      // Period in required window?
      if (!requiredPeriodIds.has(periodId)) {
        errors.push(
          `Row ${rowNum}: Period ${periodId} is outside required audit window`,
        );
        continue;
      }
      // Duplicate combo?
      const combo = `${memberId}|${periodId}`;
      if (seenCombo.has(combo)) {
        errors.push(
          `Row ${rowNum}: Duplicate entry for member ${memberMap[memberId]?.wing}-${memberMap[memberId]?.flatNo} in ${periodId}`,
        );
        duplicateCount++;
        continue;
      }
      seenCombo.add(combo);
      foundPeriods.add(periodId);
      // Parse amounts
      const prevBal = parseFloat(row.PreviousBalance) || 0;
      const intDue = parseFloat(row.InterestDue) || 0;
      const grand = parseFloat(row.GrandTotal) || 0;
      if (isNaN(prevBal) || isNaN(intDue) || isNaN(grand)) {
        errors.push(
          `Row ${rowNum}: Non-numeric amount in PreviousBalance/InterestDue/GrandTotal`,
        );
        continue;
      }
      if (prevBal < 0)
        warnings.push(
          `Row ${rowNum}: Negative PreviousBalance (${prevBal}) — verify`,
        );
      if (intDue < 0)
        errors.push(
          `Row ${rowNum}: Negative InterestDue (${intDue}) is invalid`,
        );
      // Charges
      const charges = {};
      let chargeSum = 0;
      for (const head of heads) {
        const val = parseFloat(row[head.headName]) || 0;
        charges[head.headName] = val;
        chargeSum += val;
      }
      const subtotal = parseFloat(chargeSum.toFixed(2));
      const expectedGrand = parseFloat(
        (subtotal + prevBal + intDue).toFixed(2),
      );
      if (Math.abs(expectedGrand - grand) > 0.5) {
        amountMismatches++;
        errors.push(
          `Row ${rowNum} (${memberMap[memberId]?.wing}-${memberMap[memberId]?.flatNo}, ${periodId}): ` +
            `GrandTotal mismatch — Excel: ${grand}, Expected: ${expectedGrand} ` +
            `(Subtotal ${subtotal} + PrevBal ${prevBal} + Interest ${intDue})`,
        );
      }
      billRows.push({
        memberId,
        wing: row.Wing,
        flatNo: row.FlatNo,
        ownerName: row.OwnerName,
        month: rowMonth,
        year: rowYear,
        billPeriodId: periodId,
        previousBalance: prevBal,
        interestDue: intDue,
        charges,
        subtotal,
        grandTotal: grand,
      });
    }
    // ── 6. Missing month check ───────────────────────────────────────────────
    const missingMonths = [];
    for (const p of requiredPeriods) {
      if (!foundPeriods.has(p.periodId)) missingMonths.push(p.periodId);
    }
    if (missingMonths.length > 0) {
      errors.push(`Missing bills for periods: ${missingMonths.join(", ")}`);
    }
    // Member count check
    if (foundRows > 0 && memberCount !== foundRows / win.totalMonths) {
      warnings.push(
        `Member count mismatch: system has ${memberCount} active members, ` +
          `Excel has ~${Math.round(foundRows / win.totalMonths)} members per month`,
      );
    }
    const passed = errors.length === 0;
    if (!passed) {
      return NextResponse.json({
        passed: false,
        errors,
        warnings,
        validation: {
          passed: false,
          totalMembersExpected: memberCount,
          totalRowsExpected: expectedTotalRows,
          totalRowsFound: foundRows,
          columnChecks: colChecks,
          amountChecks: amountMismatches,
          duplicateRows: duplicateCount,
          missingMonths,
          errors,
          warnings,
        },
      });
    }
    // ── 7. All checks passed — store in AuditReport ──────────────────────────
    const existing = await AuditReport.findOne({
      societyId: decoded.societyId,
    });
    if (existing) {
      // Update existing report
      existing.submittedBy = decoded.userId;
      existing.submittedByName = decoded.name || decoded.email;
      existing.submittedAt = new Date();
      existing.joinMonth = joinMonth;
      existing.joinYear = joinYear;
      existing.auditFromMonth = win.fromMonth;
      existing.auditFromYear = win.fromYear;
      existing.auditToMonth = win.toMonth;
      existing.auditToYear = win.toYear;
      existing.totalMonthsRequired = win.totalMonths;
      existing.validation = {
        totalMembersExpected: memberCount,
        totalMembersFound: Math.round(foundRows / win.totalMonths),
        totalRowsExpected: expectedTotalRows,
        totalRowsFound: foundRows,
        columnChecks: colChecks,
        amountChecks: amountMismatches,
        duplicateRows: duplicateCount,
        missingMonths,
        passed: true,
        errors: [],
        warnings,
      };
      existing.billRows = billRows;
      existing.status = "Pending";
      existing.fileName = file.name;
      existing.fileSize = file.size;
      await existing.save();
      return NextResponse.json({
        success: true,
        reportId: existing._id,
        passed: true,
        warnings,
      });
    }
    const report = await AuditReport.create({
      societyId: decoded.societyId,
      societyName: society.name,
      submittedBy: decoded.userId,
      submittedByName: decoded.name || decoded.email,
      joinMonth,
      joinYear,
      auditFromMonth: win.fromMonth,
      auditFromYear: win.fromYear,
      auditToMonth: win.toMonth,
      auditToYear: win.toYear,
      totalMonthsRequired: win.totalMonths,
      validation: {
        totalMembersExpected: memberCount,
        totalMembersFound: Math.round(foundRows / win.totalMonths),
        totalRowsExpected: expectedTotalRows,
        totalRowsFound: foundRows,
        columnChecks: colChecks,
        amountChecks: amountMismatches,
        duplicateRows: duplicateCount,
        missingMonths,
        passed: true,
        errors: [],
        warnings,
      },
      billRows,
      status: "Pending",
      fileName: file.name,
      fileSize: file.size,
    });
    return NextResponse.json({
      success: true,
      reportId: report._id,
      passed: true,
      warnings,
    });
  } catch (err) {
    console.error("audit-report POST error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
// GET /api/admin/audit-report — fetch own society's report status
export async function GET(request) {
  const gate = await authorizeAny(request, [
    "audit.page.view",
    "audit.log.read",
    "audit.report.view",
  ]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const report = await AuditReport.findOne({ societyId: decoded.societyId })
      .select("-billRows") // exclude large array from status check
      .lean();
    return NextResponse.json({ success: true, report: report || null });
  } catch (err) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting, requireAccountingClose } from "@/lib/authz";
import ChartOfAccount from "@/models/ChartOfAccount";
import { createAccount } from "@/lib/services/ChartOfAccountService";
import { createFinancialYear, getCurrentFinancialYear } from "@/lib/services/FinancialYearService";
import { updateFiscalConfig, getFiscalConfig } from "@/lib/services/FiscalConfigService";
import { seedDefaultPostingRules } from "@/lib/services/PostingRuleService";
import { seedDefaultValidationRules } from "@/lib/services/ValidationRuleService";
import { seedDefaultSchedules } from "@/lib/services/ScheduleService";
import { authorize } from "@/lib/rbac/authorize";

// One-shot orchestration for the Accounting Lab (single-page billing ->
// accounting -> Balance Sheet simulator). Idempotent: safe to call repeatedly
// — only creates what's missing (Financial Year, Chart of Accounts, seeded
// registries), never duplicates or overwrites existing data.
//
// The Chart of Accounts below is no longer the bare six-account minimum. It is
// the full set of heads that the statutory Maharashtra co-op housing society
// Balance Sheet / Income & Expenditure format actually prints, so the Lab can
// let the user fill Share Capital, Funds, Fixed Assets, Investments, Deposits
// and Current Liabilities from the SOCIETY's point of view — not just member
// billing. Schedule codes follow §6.3 of docs/accounting-system-ARD.md.
const STANDARD_ACCOUNTS = [
  // ── Assets ───────────────────────────────────────────────────────────────
  { key: "cash", code: "1001", name: "Cash in Hand", type: "Asset", subType: "Cash", scheduleCode: "H" },
  { key: "bank", code: "1002", name: "Cash at Bank", type: "Asset", subType: "Bank", scheduleCode: "H" },
  { key: "receivable", code: "1003", name: "Dues from Members", type: "Asset", subType: "Receivable", scheduleCode: "G" },
  { key: "bankFD", code: "1010", name: "Bank Fixed Deposit", type: "Asset", subType: "Investment", scheduleCode: "F" },
  { key: "landBuilding", code: "1020", name: "Land & Building", type: "Asset", subType: "FixedAsset", scheduleCode: "E" },
  { key: "fixedAssets", code: "1021", name: "Fixed Assets", type: "Asset", subType: "FixedAsset", scheduleCode: "E" },
  { key: "accumDep", code: "1029", name: "Accumulated Depreciation", type: "Asset", subType: "FixedAsset", scheduleCode: "E" },
  { key: "securityDeposit", code: "1030", name: "Security Deposit", type: "Asset", subType: "Other", scheduleCode: "G" },
  { key: "propertyTaxAdvance", code: "1031", name: "Property Tax Paid in Advance", type: "Asset", subType: "Other", scheduleCode: "G" },

  // ── Liabilities ──────────────────────────────────────────────────────────
  // memberAdvance is REQUIRED by the fixed PaymentRecorded posting rules: an
  // over-collection credits this liability instead of driving Dues from
  // Members negative (the ₹-30,149.45 defect).
  { key: "memberAdvance", code: "2001", name: "Advance Received From Members", type: "Liability", subType: "Payable", scheduleCode: "D" },
  { key: "auditFeePayable", code: "2010", name: "Audit Fee Payable", type: "Liability", subType: "Payable", scheduleCode: "D" },
  { key: "accountWritingPayable", code: "2011", name: "Account Writing Payable", type: "Liability", subType: "Payable", scheduleCode: "D" },
  { key: "electricityPayable", code: "2012", name: "Electricity Charges Payable", type: "Liability", subType: "Payable", scheduleCode: "D" },
  { key: "waterPayable", code: "2013", name: "Water Charges Payable", type: "Liability", subType: "Payable", scheduleCode: "D" },
  { key: "salaryPayable", code: "2014", name: "Salary / Security Charges Payable", type: "Liability", subType: "Payable", scheduleCode: "D" },
  { key: "tdsPayable", code: "2015", name: "TDS Payable", type: "Liability", subType: "StatutoryLiability", scheduleCode: "D" },

  // ── Equity / Funds ────────────────────────────────────────────────────
  { key: "shareCapital", code: "3000", name: "Share Capital", type: "Equity", subType: "ShareCapital", scheduleCode: "A" },
  { key: "generalFund", code: "3001", name: "General Fund", type: "Equity", subType: "GeneralFund", scheduleCode: "C" },
  { key: "reserveFund", code: "3002", name: "Reserve Fund", type: "Equity", subType: "ReserveFund", scheduleCode: "B" },
  { key: "sinkingFund", code: "3003", name: "Sinking Fund", type: "Equity", subType: "SinkingFund", scheduleCode: "B" },
  { key: "repairFund", code: "3004", name: "Building Repair & Development Fund", type: "Equity", subType: "RepairFund", scheduleCode: "B" },

  // ── Income ─────────────────────────────────────────────────────────────
  // The reference statutory I&E Account does NOT show one lumped "Maintenance
  // Income" line — it shows "BY Members Contribution" broken into the same
  // heads the society bills on (Rep.& Maint., Property Tax, Water, Electricity,
  // Service Charges, Insurance, Parking, Non-occupancy), then Interest on
  // Arrears, Bank Interest and Misc. Income as separate lines. Seeding those
  // heads is what lets the Income side print with real detail instead of two
  // rows.
  { key: "maintenanceIncome", code: "4001", name: "Members Contribution - Rep. & Maint.", type: "Income", subType: "Income", scheduleCode: "I" },
  { key: "interestIncome", code: "4002", name: "Interest on Arrears", type: "Income", subType: "Income", scheduleCode: "I" },
  { key: "bankInterestIncome", code: "4003", name: "Bank Interest (S.B. A/c)", type: "Income", subType: "Income", scheduleCode: "I" },
  { key: "miscIncome", code: "4004", name: "Misc. Income", type: "Income", subType: "Income", scheduleCode: "I" },
  { key: "propertyTaxIncome", code: "4005", name: "Members Contribution - Property Tax", type: "Income", subType: "Income", scheduleCode: "I" },
  { key: "waterIncome", code: "4006", name: "Members Contribution - Water Charges", type: "Income", subType: "Income", scheduleCode: "I" },
  { key: "electricityIncome", code: "4007", name: "Members Contribution - Electricity Charges", type: "Income", subType: "Income", scheduleCode: "I" },
  { key: "serviceChargesIncome", code: "4008", name: "Members Contribution - Service Charges", type: "Income", subType: "Income", scheduleCode: "I" },
  { key: "insuranceIncome", code: "4009", name: "Members Contribution - Insurance Charges", type: "Income", subType: "Income", scheduleCode: "I" },
  { key: "parkingIncome", code: "4010", name: "Parking Charges", type: "Income", subType: "Income", scheduleCode: "I" },
  { key: "nonOccupancyIncome", code: "4011", name: "Non-occupancy Charges", type: "Income", subType: "Income", scheduleCode: "I" },
  { key: "bankInterestTdccIncome", code: "4012", name: "Bank Interest (T.D.C.C. S.B. A/c)", type: "Income", subType: "Income", scheduleCode: "I" },
  { key: "scrapSaleIncome", code: "4013", name: "Scrap Sale", type: "Income", subType: "Income", scheduleCode: "I" },

  // ── Expenses ─────────────────────────────────────────────────────────
  // Extended from 9 heads to the ~20 the reference Expenditure side actually
  // prints (AGM, Function, Discount to Members, TDS, Computer, Professional
  // Charges, Gardening, Postage, C.C.TV, Medical, Printing & Stationery,
  // Account Writing, Inverter), so the Lab's I&E can look like the auditor's.
  { key: "repairsExpense", code: "5001", name: "Rep. & Maint.", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "propertyTaxExpense", code: "5002", name: "Property Tax", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "waterExpense", code: "5003", name: "Water Charges", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "electricityExpense", code: "5004", name: "Electricity Charges", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "insuranceExpense", code: "5005", name: "Insurance Charges", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "salaryExpense", code: "5006", name: "Salary & Wages / Security Charges", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "auditFeeExpense", code: "5007", name: "Audit Fee", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "bankChargesExpense", code: "5008", name: "Bank Charges", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "miscExpense", code: "5009", name: "Misc. Exp.", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "printingExpense", code: "5010", name: "Printing & Stationery", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "agmExpense", code: "5011", name: "AGM Exp.", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "functionExpense", code: "5012", name: "Function", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "discountToMembersExpense", code: "5013", name: "Discount to Members", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "tdsExpense", code: "5014", name: "TDS", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "computerExpense", code: "5015", name: "Computer Exp.", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "professionalChargesExpense", code: "5016", name: "Professional Charges", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "gardeningExpense", code: "5017", name: "Gardening", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "postageExpense", code: "5018", name: "Postage", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "cctvExpense", code: "5019", name: "C.C.TV Exp.", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "depreciationExpense", code: "5020", name: "Depreciation", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "medicalExpense", code: "5021", name: "Medical Exp.", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "accountWritingExpense", code: "5022", name: "Accounts Writing", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "inverterExpense", code: "5023", name: "Inverter", type: "Expense", subType: "Expense", scheduleCode: "J" },
];

export { STANDARD_ACCOUNTS };

// GET — read-only status check, never creates anything. The page uses this
// on load so a refresh never silently writes.
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const societyId = auth.user.societyId;
    const [fy, config, accounts] = await Promise.all([
      getCurrentFinancialYear(societyId),
      getFiscalConfig(societyId),
      ChartOfAccount.find({ societyId, isDeleted: false, code: { $in: STANDARD_ACCOUNTS.map((a) => a.code) } }).lean(),
    ]);
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const missing = STANDARD_ACCOUNTS.filter((a) => !byCode.has(a.code)).map((a) => a.name);
    const ready = !!fy && config.enabled && missing.length === 0;
    return NextResponse.json({
      ready,
      missing,
      financialYear: fy,
      accounts: Object.fromEntries(STANDARD_ACCOUNTS.map((a) => [a.key, byCode.get(a.code) || null])),
    });
  } catch (error) {
    console.error("Quick-setup status error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST — creates whatever's missing: Financial Year, standard Chart of
// Accounts, fiscal config mappings, and the shared default registries
// (posting rules, validation rules, schedules). Admin/Secretary only.
export async function POST(request) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.update");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const societyId = auth.user.societyId;

    let fy = await getCurrentFinancialYear(societyId);
    if (!fy) {
      fy = await createFinancialYear({ societyId, createdBy: auth.user.userId });
    }

    const existing = await ChartOfAccount.find({ societyId, isDeleted: false }).lean();
    const byCode = new Map(existing.map((a) => [a.code, a]));
   const accounts = {};
const created = [];
const renamed = [];
for (const spec of STANDARD_ACCOUNTS) {
  let acc = byCode.get(spec.code);
  if (!acc) {
    acc = await createAccount({
      societyId,
      code: spec.code,
      name: spec.name,
      type: spec.type,
      subType: spec.subType,
      scheduleCode: spec.scheduleCode,
      createdBy: auth.user.userId,
    });
    created.push(spec.code);
  } else if (acc.name !== spec.name || acc.scheduleCode !== spec.scheduleCode) {
    // Only `name` and `scheduleCode` are touched — both presentation-only.
    // `code`, `type` and `subType` are NEVER changed: existing journal lines
    // are posted against this account, and altering its type would silently
    // restate every prior voucher.
    await ChartOfAccount.updateOne(
      { _id: acc._id, societyId, isDeleted: false },
      { $set: { name: spec.name, scheduleCode: spec.scheduleCode } },
    );
    renamed.push({ code: spec.code, from: acc.name, to: spec.name });
    acc = { ...acc, name: spec.name, scheduleCode: spec.scheduleCode };
  }
  accounts[spec.key] = acc;
}

    await updateFiscalConfig(societyId, {
      enabled: true,
      defaultAccountMappings: {
        // String(), not the raw ObjectId — accounts here may come from a
        // .lean() read (existing accounts, reused on re-run) whose ObjectId
        // instances can come from a different mongoose/bson module instance
        // than the one validating Society's schema paths under Next.js dev's
        // per-route bundling, so a raw instance can fail to cast correctly.
        // Every other service in this codebase (LiabilityService,
        // AssetService, posting rules) already stores account ids as
        // strings for this reason — Mongoose casts a plain string to
        // ObjectId unconditionally, sidestepping the whole issue.
        cashAccountId: String(accounts.cash._id),
        defaultBankAccountId: String(accounts.bank._id),
        memberReceivableAccountId: String(accounts.receivable._id),
        maintenanceIncomeAccountId: String(accounts.maintenanceIncome._id),
        interestIncomeAccountId: String(accounts.interestIncome._id),
        roundOffAccountId: String(accounts.maintenanceIncome._id),
        // Over-collections credit this liability instead of driving Dues from
        // Members negative. Required by the corrected PaymentRecorded rules.
        memberAdvanceAccountId: String(accounts.memberAdvance._id),
      },
    });

    await Promise.all([seedDefaultPostingRules(), seedDefaultValidationRules(), seedDefaultSchedules()]);

return NextResponse.json({ financialYear: fy, accounts, created, renamed });
  } catch (error) {
    console.error("Quick-setup error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
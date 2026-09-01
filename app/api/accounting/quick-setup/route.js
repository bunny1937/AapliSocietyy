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
import { STANDARD_ACCOUNTS } from "@/lib/accounting/standardAccounts";

// One-shot orchestration for the Accounting Lab (single-page billing ->
// accounting -> Balance Sheet simulator). Idempotent: safe to call repeatedly
// — only creates what's missing (Financial Year, Chart of Accounts, seeded
// registries), never duplicates or overwrites existing data.
//
// STANDARD_ACCOUNTS moved to lib/accounting/standardAccounts.js on 2026-08-27
// so the setup-state service and the guided setup can read the same list
// without importing from a route handler. Re-exported here because callers
// already import it from this path.
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
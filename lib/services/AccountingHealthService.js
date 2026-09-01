import { getTrialBalance } from "@/lib/services/TrialBalanceService";
import { getOpeningStatus } from "@/lib/services/OpeningBalanceService";
import { runValidations } from "@/lib/services/ValidationRuleService";
import { getClosingChecklist } from "@/lib/services/FinancialClosingService";
import { getFiscalConfig } from "@/lib/services/FiscalConfigService";

// Phase 2.20 of the accounting-system revamp (docs/accounting-system-ARD.md
// §6.14, §8) — the final phase of the Phase 2 roadmap. Read-only computed
// view, pure aggregation over everything Phases 2.9–2.19 already built — no
// new source-of-truth data (§1 "reports never contain business logic"). Its
// product role is a gate/guide before financial-statement generation or the
// Financial Closing Wizard, not a standalone report.

export class AccountingHealthServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "AccountingHealthServiceError";
    this.status = status;
  }
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

// Maps a weight key to the Validation Engine rule it reads pass/fail from.
const VALIDATION_RULE_BY_WEIGHT_KEY = {
  draftVouchers: "draftVouchersPending",
  depreciation: "assetsMissingDepreciationThisYear",
  bankReconciliation: "bankStatementsUnmatched",
  scheduleCoverage: "accountsMissingScheduleCode",
};

export async function getHealthDashboard(societyId, financialYearId) {
  if (!financialYearId) throw new AccountingHealthServiceError(400, "financialYearId is required");

  const [trialBalance, openingStatus, validation, closingChecklist, config] = await Promise.all([
    getTrialBalance(societyId, financialYearId),
    getOpeningStatus(societyId, financialYearId),
    runValidations(societyId, { financialYearId }),
    getClosingChecklist(societyId, financialYearId),
    getFiscalConfig(societyId),
  ]);

  const weights = config.healthScoreWeights;
  const weightTotal = Object.values(weights).reduce((s, w) => s + w, 0) || 100;
  const normalize = (w) => (w / weightTotal) * 100;

  const resultByRule = new Map(validation.results.map((r) => [r.rule, r]));
  const mainRuleKeys = new Set(Object.values(VALIDATION_RULE_BY_WEIGHT_KEY));
  const otherResults = validation.results.filter((r) => !mainRuleKeys.has(r.rule));

  const components = [];

  components.push({
    key: "trialBalance",
    label: "Trial Balance is balanced",
    weight: normalize(weights.trialBalance),
    passed: trialBalance.isBalanced,
    score: trialBalance.isBalanced ? normalize(weights.trialBalance) : 0,
    reason: trialBalance.isBalanced
      ? `Debits ₹${trialBalance.totalDebit.toLocaleString("en-IN")} = Credits ₹${trialBalance.totalCredit.toLocaleString("en-IN")} for ${trialBalance.financialYearLabel}.`
      : `Debits ₹${trialBalance.totalDebit.toLocaleString("en-IN")} vs Credits ₹${trialBalance.totalCredit.toLocaleString("en-IN")} — off by ₹${Math.abs(trialBalance.difference).toLocaleString("en-IN")}.`,
    fix: trialBalance.isBalanced
      ? null
      : "Every posted voucher must have equal debit and credit lines. Open the Ledger and look for a voucher whose lines don't sum to zero, or a Draft voucher that was partially posted.",
    navigationTarget: trialBalance.isBalanced ? null : "/admin/ledger",
  });

  components.push({
    key: "openingBalance",
    label: "Opening balances confirmed",
    weight: normalize(weights.openingBalance),
    passed: openingStatus.openingBalancesConfirmed,
    score: openingStatus.openingBalancesConfirmed ? normalize(weights.openingBalance) : 0,
    reason: openingStatus.openingBalancesConfirmed
      ? `Opening balances were posted and confirmed for this Financial Year.`
      : openingStatus.canEnterOpening
        ? `No opening balances entered yet for this Financial Year (no transactions recorded so far — this is expected for a brand-new Financial Year).`
        : `${openingStatus.voucherCount} transaction(s) already recorded this Financial Year, but opening balances were never entered. Either this Financial Year genuinely started from zero (nothing to fix), or the society's starting cash/bank/dues/funds are missing from the books.`,
    fix: openingStatus.openingBalancesConfirmed
      ? null
      : openingStatus.canEnterOpening
        ? "Enter the society's opening figures — cash in hand/bank, fixed deposits, property, dues owed by members, and accumulated Funds — on the Opening Balances page. This is a one-time setup per Financial Year and must be done before any other entry."
        : "Open the Opening Balances page — it now asks directly whether a starting balance is genuinely missing (and lets you post it as a correction) or this year started from zero (one-click, nothing to post).",
    navigationTarget: openingStatus.openingBalancesConfirmed ? null : "/admin/opening-balances",
  });

  for (const [weightKey, ruleKey] of Object.entries(VALIDATION_RULE_BY_WEIGHT_KEY)) {
    const result = resultByRule.get(ruleKey);
    const passed = result ? result.passed : true; // rule not registered for this society → treat as not-applicable/pass
    components.push({
      key: weightKey,
      label: result?.description || ruleKey,
      weight: normalize(weights[weightKey]),
      passed,
      score: passed ? normalize(weights[weightKey]) : 0,
      reason: result ? result.message : "No validation rule registered for this check — treated as not applicable.",
      fix: passed ? null : result?.suggestedResolution || result?.helpText || null,
      navigationTarget: passed ? null : result?.navigationTarget || null,
      items: passed ? [] : result?.items || [],
    });
  }

  const otherPassedFraction = otherResults.length === 0 ? 1 : otherResults.filter((r) => r.passed).length / otherResults.length;
  components.push({
    key: "otherValidations",
    label: "Other validation checks",
    weight: normalize(weights.otherValidations),
    passed: otherPassedFraction === 1,
    score: round2(normalize(weights.otherValidations) * otherPassedFraction),
    reason:
      otherResults.length === 0
        ? "No other validation rules are registered for this society."
        : `${otherResults.filter((r) => r.passed).length} of ${otherResults.length} other checks passed.`,
    failedChecks: otherResults
      .filter((r) => !r.passed)
      .map((r) => ({ label: r.description, message: r.message, fix: r.suggestedResolution || r.helpText || null, navigationTarget: r.navigationTarget || null })),
  });

  const healthScore = Math.max(0, Math.min(100, Math.round(components.reduce((s, c) => s + c.score, 0))));

  const warnings = validation.results
    .filter((r) => !r.passed)
    .map((r) => ({ rule: r.rule, severity: r.severity, message: r.message, navigationTarget: r.navigationTarget, suggestedResolution: r.suggestedResolution }));

  return {
    financialYearId: String(financialYearId),
    financialYearLabel: trialBalance.financialYearLabel,
    healthScore,
    components,
    warnings,
    pendingTasks: closingChecklist.blockingFailures,
    financialYearReadiness: {
      status: closingChecklist.status,
      nextStatus: closingChecklist.nextStatus,
      readyToClose: closingChecklist.readyToClose,
    },
  };
}

/**
 * AapliSociety Accounting — "where does this society actually stand?"
 * ============================================================================
 * ONE answer to that question, for every accounting screen to share.
 *
 * ## Why this exists
 *
 * Five pages used to tell an admin "No Financial Year found — create one under
 * Accounting first", and Accounting did not exist in the navigation. Each page
 * had reached its own conclusion about what was missing and written its own
 * dead-end sentence. Five conclusions drift into five different answers, and
 * none of them could link anywhere, because none of them knew where to send
 * anyone.
 *
 * So the rule is: a page never works out what is missing. It asks this.
 *
 * ## Why it is not just getHealthDashboard()
 *
 * AccountingHealthService answers "are the books correct" and needs a
 * Financial Year to answer at all — it throws 400 without one. That is the
 * right behaviour for a health check and useless for the case that is actually
 * broken, which is a society where nothing exists yet.
 *
 * This answers the earlier question: "has the society been set up". It works
 * from a completely empty database, and folds the health checks in on top once
 * there is a Financial Year for them to run against.
 *
 * ## The shape, and why every field is there
 *
 * Each step carries what a non-technical reader needs to act:
 *
 *   label   what this is, in his words        "Financial Year"
 *   what    why it matters, one sentence      "The year the books cover..."
 *   status  done | missing | blocked          blocked = an earlier step first
 *   detail  where he stands right now         "2025-26, started 1 April 2025"
 *   fix     the next physical action          "Create this year's Financial Year"
 *   href    where that action happens         "/admin/accounting/financial-years"
 *
 * `blocked` matters as much as `missing`. Telling someone to set up a Chart of
 * Accounts when there is no Financial Year to hang it on sends them somewhere
 * that will refuse them. A blocked step names the step it is waiting for.
 *
 * See docs/accounting-guided-ux/00-plan.md §3.
 * ============================================================================
 */

import connectDB from "@/lib/mongodb";
import mongoose from "mongoose";
import ChartOfAccount from "@/models/ChartOfAccount";
import PostingRule from "@/models/PostingRule";
import ValidationRule from "@/models/ValidationRule";
import Schedule from "@/models/Schedule";
import Voucher from "@/models/Voucher";
import JournalEntry from "@/models/JournalEntry";
import Fund from "@/models/Fund";
import { STANDARD_ACCOUNTS } from "@/lib/accounting/standardAccounts";
import { getOrCreateChartProfile } from "@/lib/accounting/chartProfile";
import {
  listFinancialYears,
  getCurrentFinancialYear,
} from "@/lib/services/FinancialYearService";
import { getFiscalConfig } from "@/lib/services/FiscalConfigService";
import { getOpeningStatus } from "@/lib/services/OpeningBalanceService";
import { getHealthDashboard } from "@/lib/services/AccountingHealthService";

/**
 * Every href a step can hand out. Centralised because the first version of
 * this file pointed at /admin/accounting/chart-of-accounts, which does not
 * exist yet — and app/admin/[...catchAll]/page.js redirects any unknown admin
 * path to /admin/dashboard. So a "Fix" button silently dumped the admin on
 * the dashboard: the exact dead end this service was written to remove, with
 * a redirect hiding it.
 *
 * RULE: nothing goes in this map until the page exists. The four setup steps
 * that have no page of their own point at the guided setup, which is where
 * they are actually performed.
 */
// Folded into Hub drawers / the Books and Statements tabbed pages (design
// doc §12 Phase 4/5) — these point straight at the new URLs (matching
// lib/rbac/page-catalog.js exactly, which tests/unit/accounting-setup-routes
// enforces) rather than the old standalone paths, which still work but only
// via a redirect hop this skips.
export const ROUTES = {
  overview: "/admin/accounting",
  setup: "/admin/accounting/setup",
  chartOfAccounts: "/admin/accounting/chart-of-accounts",
  financialYears: "/admin/accounting?drawer=financial-years",
  postingRules: "/admin/accounting?drawer=posting-rules",
  validationRules: "/admin/accounting?drawer=validation-rules",
  schedules: "/admin/accounting?drawer=schedules",
  vouchers: "/admin/accounting/books?tab=entries",
  journalEntries: "/admin/accounting/books?tab=books",
  auditTrail: "/admin/accounting/books?tab=corrections",
  assets: "/admin/accounting/assets",
  openingBalances: "/admin/opening-balances",
  ledger: "/admin/ledger",
  generateBills: "/admin/generate-bills",
  statements: "/admin/accounting/statements?tab=generate",
};

const DONE = "done";
const MISSING = "missing";
const BLOCKED = "blocked";

/**
 * The April-to-March year today falls in. Used only to name a concrete example
 * date range before a Financial Year exists — a reader who has never created
 * one still needs to see real years, not a template.
 */
function defaultYearStart(now = new Date()) {
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(y, 3, 1);
}
function defaultYearEnd(now = new Date()) {
  const start = defaultYearStart(now);
  return new Date(start.getFullYear() + 1, 2, 31);
}

const dateText = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";

/**
 * The full picture. Safe on an empty database — that is its main job.
 *
 * @param {string} societyId
 * @returns {Promise<object>}
 */
export async function getSetupState(societyId) {
  await connectDB();

  const sid = societyId;
  const scope = { societyId: sid, isDeleted: { $ne: true } };

  const [
    years,
    currentFy,
    config,
    accounts,
    postingRuleCount,
    validationRuleCount,
    scheduleCount,
    voucherCount,
    journalEntryCount,
    fundCount,
    chartProfile,
  ] = await Promise.all([
    listFinancialYears(sid).catch(() => []),
    getCurrentFinancialYear(sid).catch(() => null),
    getFiscalConfig(sid).catch(() => null),
    ChartOfAccount.find(scope).select("code name type isActive").lean(),
    // Seeded registries are society-agnostic (societyId: null) plus any this
    // society added of its own, which is why both are counted.
    PostingRule.countDocuments({
      isDeleted: { $ne: true },
      $or: [{ societyId: sid }, { societyId: null }],
    }).catch(() => 0),
    ValidationRule.countDocuments({
      isDeleted: { $ne: true },
      $or: [{ societyId: sid }, { societyId: null }],
    }).catch(() => 0),
    Schedule.countDocuments({
      isDeleted: { $ne: true },
      $or: [{ societyId: sid }, { societyId: null }],
    }).catch(() => 0),
    Voucher.countDocuments(scope).catch(() => 0),
    JournalEntry.countDocuments(scope).catch(() => 0),
    Fund.countDocuments(scope).catch(() => 0),
    getOrCreateChartProfile(sid).catch(() => null),
  ]);

  // The Financial Year everything else is judged against: the one covering
  // today if there is one, otherwise the most recent, so a society whose year
  // has rolled over still sees its books rather than an empty page.
  const fy = currentFy || years[0] || null;

  const haveCodes = new Set(accounts.map((a) => a.code));
  // §12 Phase 3: compares against the society's chart profile, not the raw
  // template — a deliberately deleted head never comes back as "missing".
  // See lib/accounting/chartProfile.js.
  const removedCodes = new Set(chartProfile?.removedCodes || []);
  const missingAccounts = STANDARD_ACCOUNTS.filter((a) => !haveCodes.has(a.code) && !removedCodes.has(a.code));

  let openingStatus = null;
  if (fy) {
    openingStatus = await getOpeningStatus(sid, String(fy._id)).catch(() => null);
  }

  const steps = [];

  // ── 1. Financial Year ──────────────────────────────────────────────────
  steps.push({
    key: "financialYear",
    label: "Financial Year",
    // Named with its real years. "1 April to 31 March" on its own is a
    // template, not a date — it says nothing about WHICH year, which is the
    // only thing the reader is trying to work out.
    what: fy
      ? `The year your books cover: ${dateText(fy.startDate)} to ${dateText(fy.endDate)}. Everything else is recorded inside it.`
      : `The year your books cover — for example ${dateText(defaultYearStart())} to ${dateText(defaultYearEnd())}. Everything else is recorded inside one.`,
    status: fy ? DONE : MISSING,
    detail: fy
      ? `${fy.label} — ${dateText(fy.startDate)} to ${dateText(fy.endDate)}, currently ${String(fy.status || "Draft").toLowerCase()}`
      : "No Financial Year has been created yet. Nothing else can be recorded until there is one.",
    fix: fy ? null : "Create this year's Financial Year. It takes one click.",
    href: ROUTES.financialYears,
    count: years.length,
  });

  // ── 2. Chart of Accounts ───────────────────────────────────────────────
  const accountsDone = accounts.length > 0 && missingAccounts.length === 0;
  steps.push({
    key: "chartOfAccounts",
    label: "List of account heads",
    what: "The named pockets money moves between — Cash in Hand, Bank, Dues from Members, Repairs, and so on. The same heads your auditor's statement prints.",
    status: !fy ? BLOCKED : accountsDone ? DONE : MISSING,
    detail: !fy
      ? "Waiting on the Financial Year above."
      : accounts.length === 0
        ? "No account heads exist yet. The standard set for a housing society can be created for you."
        : missingAccounts.length
          ? `${accounts.length} head(s) exist, ${missingAccounts.length} still missing — including ${missingAccounts
              .slice(0, 3)
              .map((a) => a.name)
              .join(", ")}${missingAccounts.length > 3 ? " and others" : ""}.`
          : `All ${accounts.length} standard heads are in place.`,
    fix: !fy
      ? "Create the Financial Year first."
      : accountsDone
        ? null
        : "Add the missing account heads.",
    href: !fy ? ROUTES.financialYears : accounts.length ? ROUTES.chartOfAccounts : ROUTES.setup,
    count: accounts.length,
    missingItems: missingAccounts.map((a) => a.name),
  });

  // ── 3. Posting rules ───────────────────────────────────────────────────
  // These are what turn "a bill was raised" into the two-sided entry, without
  // anybody deciding it by hand each time.
  steps.push({
    key: "postingRules",
    label: "Automatic entry rules",
    what: "How the system records a bill or a payment into the books on its own, so nobody enters both sides by hand.",
    status: !fy ? BLOCKED : postingRuleCount > 0 ? DONE : MISSING,
    detail: !fy
      ? "Waiting on the Financial Year above."
      : postingRuleCount > 0
        ? `${postingRuleCount} rule(s) active.`
        : "No rules yet, so bills and payments will not reach the books on their own.",
    fix: !fy ? "Create the Financial Year first." : postingRuleCount > 0 ? null : "Add the standard rules.",
    // Its own page once there is something on it; the setup runner is where
    // an empty registry actually gets filled.
    href: postingRuleCount > 0 ? ROUTES.postingRules : ROUTES.setup,
    count: postingRuleCount,
  });

  // ── 4. Checks ──────────────────────────────────────────────────────────
  steps.push({
    key: "validationRules",
    label: "Book health checks",
    what: "The checks run before any statement is printed — that both sides match, that nothing is left half-recorded.",
    status: !fy ? BLOCKED : validationRuleCount > 0 ? DONE : MISSING,
    detail: !fy
      ? "Waiting on the Financial Year above."
      : validationRuleCount > 0
        ? `${validationRuleCount} check(s) active.`
        : "No checks configured, so mistakes would not be caught before printing.",
    fix: !fy ? "Create the Financial Year first." : validationRuleCount > 0 ? null : "Add the standard checks.",
    href: validationRuleCount > 0 ? ROUTES.validationRules : ROUTES.setup,
    count: validationRuleCount,
  });

  // ── 5. Statement layout ────────────────────────────────────────────────
  steps.push({
    key: "schedules",
    label: "Statement layout",
    what: "Which account head prints under which heading on the final Balance Sheet — Schedule A, B, C and so on.",
    status: !fy ? BLOCKED : scheduleCount > 0 ? DONE : MISSING,
    detail: !fy
      ? "Waiting on the Financial Year above."
      : scheduleCount > 0
        ? `${scheduleCount} schedule(s) defined.`
        : "Not set up, so the statements have no layout to print into.",
    fix: !fy ? "Create the Financial Year first." : scheduleCount > 0 ? null : "Add the standard layout.",
    href: scheduleCount > 0 ? ROUTES.schedules : ROUTES.setup,
    count: scheduleCount,
  });

  // ── 6. Opening balances ────────────────────────────────────────────────
  //
  // The one step with a real deadline. It can only be entered while the year
  // has no other transactions in it; after that it needs a correcting entry
  // instead, which is a different and much less pleasant job. So when it is
  // still possible but not done, that is worth saying out loud.
  const openingConfirmed = !!openingStatus?.openingBalancesConfirmed;
  const canStillEnterOpening = !!openingStatus?.canEnterOpening;
  steps.push({
    key: "openingBalances",
    label: "Last year's closing figures",
    what: "What the society held on day one of this year — cash, bank, what members still owed, and the funds. Carried in from last year's closing statement.",
    status: !fy ? BLOCKED : openingConfirmed ? DONE : MISSING,
    detail: !fy
      ? "Waiting on the Financial Year above."
      : openingConfirmed
        ? "Entered and confirmed."
        : canStillEnterOpening
          ? "Not entered yet. This year has no other entries in it, so it can still be entered normally."
          : `${openingStatus?.voucherCount ?? 0} entr(ies) already recorded this year, so this can no longer be entered here — it now needs a correcting entry instead.`,
    fix: !fy
      ? "Create the Financial Year first."
      : openingConfirmed
        ? null
        : canStillEnterOpening
          ? "Enter last year's closing cash, bank, dues and funds."
          : "Open this step to say whether a starting balance is genuinely missing, or this year started from zero.",
    // Opening Balances itself now offers both doors once other entries
    // exist — a correcting-entry form, or a one-click "started from zero"
    // confirmation. It used to send an admin to the Ledger, a page with no
    // button that does either — a dead end dressed as an answer.
    href: !fy ? ROUTES.financialYears : ROUTES.openingBalances,
    urgent: !!fy && !openingConfirmed && canStillEnterOpening,
  });

  // ── 7. Activity ────────────────────────────────────────────────────────
  // Not a setup step — a "have the books started moving" step. Reported so an
  // admin who has finished setup sees the next thing to do rather than a wall
  // of green ticks and no suggestion.
  steps.push({
    key: "activity",
    label: "Entries recorded",
    what: "Receipts and payment slips. Raising bills and recording payments creates these on their own.",
    status: !fy ? BLOCKED : voucherCount > 0 ? DONE : MISSING,
    detail: !fy
      ? "Waiting on the Financial Year above."
      : voucherCount > 0
        ? `${voucherCount} entr(ies) recorded this year.`
        : "Nothing recorded yet. Raising the first bills will start the books.",
    fix: !fy ? "Create the Financial Year first." : voucherCount > 0 ? null : "Raise this month's bills.",
    href: !fy ? ROUTES.financialYears : voucherCount > 0 ? ROUTES.vouchers : ROUTES.generateBills,
    count: voucherCount,
  });

  // ── health, folded in ──────────────────────────────────────────────────
  // Only meaningful once there is a year to check. Never allowed to take the
  // page down with it: a society mid-setup can trip a health check in ways
  // that are not interesting yet, and "the checklist failed to load" would be
  // a worse answer than "health not available".
  let health = null;
  if (fy) {
    health = await getHealthDashboard(sid, String(fy._id)).catch(() => null);
  }

  const required = steps.filter((s) => s.key !== "activity");
  const blockers = required.filter((s) => s.status !== DONE);

  return {
    ready: blockers.length === 0,
    // The first thing standing in the way, which is the only thing worth
    // putting in front of someone who has just been stopped.
    nextStep: blockers[0] || null,
    financialYear: fy
      ? {
          id: String(fy._id),
          label: fy.label,
          startDate: fy.startDate,
          endDate: fy.endDate,
          status: fy.status || "Draft",
          openingBalancesConfirmed: openingConfirmed,
        }
      : null,
    financialYearCount: years.length,
    accountingEnabled: config?.enabled !== false,
    steps,
    counts: {
      financialYears: years.length,
      accounts: accounts.length,
      accountsExpected: STANDARD_ACCOUNTS.length,
      postingRules: postingRuleCount,
      validationRules: validationRuleCount,
      schedules: scheduleCount,
      vouchers: voucherCount,
      journalEntries: journalEntryCount,
      funds: fundCount,
    },
    health,
  };
}

/**
 * Just enough for a page-top prerequisite banner, without the counts and
 * health payload a full checklist needs.
 *
 * @param {string} societyId
 * @param {string} requiredStepKey the step this page cannot work without
 */
export async function getPrerequisite(societyId, requiredStepKey) {
  const state = await getSetupState(societyId);
  const step = state.steps.find((s) => s.key === requiredStepKey) || null;
  return {
    satisfied: step ? step.status === DONE : true,
    step,
    nextStep: state.nextStep,
    ready: state.ready,
  };
}

export default getSetupState;

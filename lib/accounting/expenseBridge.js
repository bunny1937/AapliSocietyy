/**
 * AapliSociety — the bridge from a recorded expense to the actual books.
 * ============================================================================
 * SERVER ONLY.
 *
 * ## The problem this closes
 *
 * `/admin/expenditure` writes to the `Expense` collection through
 * `/api/expenses`, and that route never touched the Accounting Engine. So an
 * expense entered by an admin was recorded, listed, and totalled — and never
 * reached the double-entry books. The ledger-built Income & Expenditure
 * statement did not know it existed.
 *
 * Meanwhile `app/api/accounting/lab/expenses/route.js` was the ONLY producer
 * of an expense posting anywhere in the codebase. The test harness could book
 * an expense into the accounts; the real page could not.
 *
 * ## The rule this follows, and it matters
 *
 * **Recording the expense must never fail because the books are not ready.**
 *
 * A society that has not finished accounting setup still has a secretary
 * paying the electricity bill, and a 500 on that screen because no Financial
 * Year exists would be a straight regression on a page that works today. So
 * every failure here is caught, named, and returned as a reason — the caller
 * saves the expense either way and tells the user what did or did not reach
 * the books.
 *
 * That is also why this returns a result object and never throws.
 *
 * ## Why the categories are mapped rather than matched
 *
 * `Expense.category` is a fixed list of fifteen written for the old page —
 * "Housekeeping", "Lift/Elevator", "Festival & Events". The chart of accounts
 * uses the heads a Maharashtra society's statutory statement prints — "Salary
 * & Wages / Security Charges", "Rep. & Maint.", "Function". They do not line
 * up one to one and never will, because one list describes what the money was
 * for and the other describes where the auditor expects to see it.
 *
 * So each category maps to the closest real head, and the original category is
 * written into the line narration. Three categories share head 5006 — that is
 * correct, not lossy: the statutory statement prints one line for staff and
 * security, and the detail survives in the narration and in the Expense row
 * itself.
 * ============================================================================
 */

import ChartOfAccount from "@/models/ChartOfAccount";
import FinancialYear from "@/models/FinancialYear";
import { getFiscalConfig } from "@/lib/services/FiscalConfigService";
import { EVENT_TYPES, createAccountingEvent } from "@/lib/accounting/events.js";
import { process as engineProcess } from "@/lib/accounting/AccountingEngine.js";

/**
 * Expense.category → the chart-of-accounts code that carries it on the
 * statutory Income & Expenditure statement.
 *
 * Every code here exists in lib/accounting/standardAccounts.js. A society that
 * has deactivated or never created one gets a named skip, not a crash.
 */
export const EXPENSE_CATEGORY_ACCOUNTS = Object.freeze({
  Salary: "5006",                    // Salary & Wages / Security Charges
  Security: "5006",
  Housekeeping: "5006",
  "Repairs & Maintenance": "5001",   // Rep. & Maint.
  "Lift/Elevator": "5001",
  Electricity: "5004",               // Electricity Charges
  Water: "5003",                     // Water Charges
  Garden: "5017",                    // Gardening
  "Legal & Professional": "5016",    // Professional Charges
  Audit: "5007",                     // Audit Fee
  Insurance: "5005",                 // Insurance Charges
  "Property Tax": "5002",            // Property Tax
  "Bank Charges": "5008",            // Bank Charges
  "Festival & Events": "5012",       // Function
  Miscellaneous: "5009",             // Misc. Exp.
});

/** Cash in hand for cash, the society's bank for everything else. */
const CASH_CODE = "1001";
const BANK_CODE = "1002";

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/** A skip, named. Never an exception — see the header. */
const skip = (reason) => ({ posted: false, reason });

/**
 * Posts one recorded expense into the books as Dr <expense head>,
 * Cr <cash or bank>.
 *
 * @param {object}  args
 * @param {string}  args.societyId
 * @param {object}  args.expense      the saved Expense document (lean or doc)
 * @param {string}  [args.actorUserId]
 * @returns {Promise<{posted:boolean, reason?:string, voucherId?:string,
 *                    voucherNumber?:string, idempotentHit?:boolean,
 *                    debitAccount?:string, creditAccount?:string}>}
 */
export async function postExpenseToBooks({ societyId, expense, actorUserId }) {
  try {
    const config = await getFiscalConfig(societyId).catch(() => null);
    if (config?.enabled === false) {
      return skip("Accounting is switched off for this society, so nothing was posted to the books.");
    }

    const date = expense.date ? new Date(expense.date) : new Date();
    const financialYear = await FinancialYear.findOne({
      societyId,
      isDeleted: false,
      startDate: { $lte: date },
      endDate: { $gte: date },
    }).lean();
    if (!financialYear) {
      return skip(
        "No Financial Year covers this date, so the expense was saved but has not reached the books. Create the Financial Year and this can be recorded again.",
      );
    }
    // A locked year is locked for a reason — a correction belongs in Auditor
    // Mode, not in a side door from the expenditure page.
    if (financialYear.status === "Locked") {
      return skip(
        `Financial Year ${financialYear.label} is locked, so the expense was saved but not posted. A correction to a locked year has to go through the auditor.`,
      );
    }

    const code = EXPENSE_CATEGORY_ACCOUNTS[expense.category];
    if (!code) {
      return skip(
        `"${expense.category}" has no matching account head, so the expense was saved but not posted.`,
      );
    }

    const fundingCode = expense.paymentMethod === "Cash" ? CASH_CODE : BANK_CODE;

    const accounts = await ChartOfAccount.find({
      societyId,
      isDeleted: { $ne: true },
      code: { $in: [code, fundingCode] },
    }).lean();
    const byCode = new Map(accounts.map((a) => [a.code, a]));

    const expenseAccount = byCode.get(code);
    const fundingAccount = byCode.get(fundingCode);
    if (!expenseAccount || !fundingAccount) {
      const missing = [!expenseAccount && code, !fundingAccount && fundingCode].filter(Boolean);
      return skip(
        `The account head${missing.length > 1 ? "s" : ""} ${missing.join(" and ")} ${missing.length > 1 ? "do" : "does"} not exist yet, so the expense was saved but not posted. Create the standard account heads first.`,
      );
    }
    if (expenseAccount.isActive === false || fundingAccount.isActive === false) {
      return skip(
        "One of the account heads this would post to is switched off, so the expense was saved but not posted.",
      );
    }

    const amount = round2(expense.amount);
    const detail = [expense.category, expense.vendor, expense.description]
      .map((v) => String(v || "").trim())
      .filter(Boolean)
      .join(" — ");

    const event = createAccountingEvent({
      type: EVENT_TYPES.MANUAL_ADJUSTMENT,
      societyId,
      financialYearId: financialYear._id,
      sourceModule: "Manual",
      sourceRef: expense._id,
      actorUserId,
      // One expense row, one voucher, for ever. Re-running the bridge over the
      // same row is a no-op the engine recognises rather than a second entry.
      idempotencyKey: `expense:${expense._id}`,
      payload: {
        // Matches default:ExpenseRecorded (priority 5) rather than the generic
        // manual-adjustment rule, so the voucher comes out as a Payment — which
        // is what money leaving the society actually is.
        kind: "Expense",
        date,
        narration: `Expense — ${detail || expenseAccount.name}`,
        lines: [
          {
            accountId: String(expenseAccount._id),
            side: "Debit",
            amount,
            narration: `${expense.category} — ${expenseAccount.name}`,
          },
          {
            accountId: String(fundingAccount._id),
            side: "Credit",
            amount,
            narration: `Paid from ${fundingAccount.name}`,
          },
        ],
      },
    });

    const result = await engineProcess(event);
    return {
      posted: true,
      idempotentHit: !!result?.idempotentHit,
      voucherId: result?.voucher?._id ? String(result.voucher._id) : null,
      voucherNumber: result?.voucher?.voucherNumber || null,
      debitAccount: `${expenseAccount.code} ${expenseAccount.name}`,
      creditAccount: `${fundingAccount.code} ${fundingAccount.name}`,
    };
  } catch (error) {
    // The expense is already saved by the time this runs. Whatever went wrong
    // in the engine, it must not turn a successful recording into a failure —
    // it becomes a reason the caller can show and act on.
    console.error("Expense → books bridge failed:", error);
    return skip(
      error?.message
        ? `The expense was saved, but posting it to the books failed: ${error.message}`
        : "The expense was saved, but posting it to the books failed.",
    );
  }
}

export default postExpenseToBooks;

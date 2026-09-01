import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccountingClose } from "@/lib/authz";
import {
  postOpeningBalanceCorrection,
  OpeningBalanceServiceError,
} from "@/lib/services/OpeningBalanceService";
import { AccountingEngineError } from "@/lib/accounting/AccountingEngine.js";
import { AccountingEventError } from "@/lib/accounting/events.js";
import { PostingRuleError } from "@/lib/accounting/postingRules/accountResolvers.js";
import { authorizeAny } from "@/lib/rbac/authorize";

// POST /api/accounting/opening-balance/correction
// ----------------------------------------------------------------------------
// For the one door the plain opening-balance flow doesn't have: the Financial
// Year already has other vouchers in it, so it can't be entered as the first
// slip any more — but a starting cash/bank/dues/funds figure can genuinely
// still be missing. Posts it as a dated correction instead. Same permission
// as posting opening balances normally — this is that same step, just later.
export async function POST(request) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, [
    "statements.openingBalances.update",
    "society.systemTests.update",
  ]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json();
    const result = await postOpeningBalanceCorrection(
      auth.user.societyId,
      {
        financialYearId: body.financialYearId,
        entries: body.entries,
        openingFundAccountId: body.openingFundAccountId,
        date: body.date,
        narration: body.narration,
      },
      auth.user.userId,
    );
    return NextResponse.json({ voucher: result.voucher, journalEntry: result.journalEntry }, { status: 201 });
  } catch (error) {
    if (
      error instanceof OpeningBalanceServiceError ||
      error instanceof AccountingEngineError ||
      error instanceof AccountingEventError ||
      error instanceof PostingRuleError
    ) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("Post opening balance correction error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

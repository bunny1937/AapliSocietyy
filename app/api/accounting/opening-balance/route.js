import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting, requireAccountingClose } from "@/lib/authz";
import {
  postOpeningBalances,
  getOpeningStatus,
  OpeningBalanceServiceError,
} from "@/lib/services/OpeningBalanceService";
import { AccountingEngineError } from "@/lib/accounting/AccountingEngine.js";
import { AccountingEventError } from "@/lib/accounting/events.js";
import { PostingRuleError } from "@/lib/accounting/postingRules/accountResolvers.js";
import { authorize, authorizeAny } from "@/lib/rbac/authorize";

// GET /api/accounting/opening-balance?financialYearId=  → status
// Read by app/admin/opening-balances/PageClient.js — its actual, named page.
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, [
    "statements.openingBalances.view",
    "society.systemTests.view",
  ]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const financialYearId = searchParams.get("financialYearId");
    if (!financialYearId) {
      return NextResponse.json({ error: "financialYearId is required" }, { status: 400 });
    }
    const status = await getOpeningStatus(auth.user.societyId, financialYearId);
    return NextResponse.json({ status });
  } catch (error) {
    if (error instanceof OpeningBalanceServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Opening balance status error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST /api/accounting/opening-balance — post the opening balances. Admin/Secretary only.
// Body: { financialYearId, openingFundAccountId, entries: [{ accountId, amount, side? }], date?, narration? }
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
    const result = await postOpeningBalances(
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
    console.error("Post opening balance error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccountingClose } from "@/lib/authz";
import { transferBetweenFunds, FundServiceError } from "@/lib/services/FundService";
import { AccountingEngineError } from "@/lib/accounting/AccountingEngine.js";
import { AccountingEventError } from "@/lib/accounting/events.js";
import { PostingRuleError } from "@/lib/accounting/postingRules/accountResolvers.js";
import { authorize } from "@/lib/rbac/authorize";

// POST /api/accounting/funds/transfer — appropriation between two funds. Admin/Secretary only.
// Body: { fromFundId, toFundId, amount, date?, note? }
export async function POST(request) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.update");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json();
    const result = await transferBetweenFunds(
      auth.user.societyId,
      {
        fromFundId: body.fromFundId,
        toFundId: body.toFundId,
        amount: body.amount,
        date: body.date,
        note: body.note,
      },
      auth.user.userId,
    );
    return NextResponse.json(result);
  } catch (error) {
    if (
      error instanceof FundServiceError ||
      error instanceof AccountingEngineError ||
      error instanceof AccountingEventError ||
      error instanceof PostingRuleError
    ) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("Transfer between funds error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

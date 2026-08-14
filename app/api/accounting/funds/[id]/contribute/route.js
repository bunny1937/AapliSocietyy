import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccountingClose } from "@/lib/authz";
import { contributeToFund, FundServiceError } from "@/lib/services/FundService";
import { AccountingEngineError } from "@/lib/accounting/AccountingEngine.js";
import { AccountingEventError } from "@/lib/accounting/events.js";
import { PostingRuleError } from "@/lib/accounting/postingRules/accountResolvers.js";

// POST /api/accounting/funds/[id]/contribute — Admin/Secretary only.
// Body: { contraAccountId, amount, date?, note? }
export async function POST(request, { params }) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { id } = await params;
    const body = await request.json();
    const result = await contributeToFund(
      auth.user.societyId,
      id,
      { contraAccountId: body.contraAccountId, amount: body.amount, date: body.date, note: body.note },
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
    console.error("Contribute to fund error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

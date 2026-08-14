import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccountingClose } from "@/lib/authz";
import { recordLiabilityPayment, LiabilityServiceError } from "@/lib/services/LiabilityService";
import { AccountingEngineError } from "@/lib/accounting/AccountingEngine.js";
import { AccountingEventError } from "@/lib/accounting/events.js";
import { PostingRuleError } from "@/lib/accounting/postingRules/accountResolvers.js";

// POST /api/accounting/liabilities/[id]/pay — Admin/Secretary only.
// Body: { date?, amount, payingAccountId, note? }
export async function POST(request, { params }) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { id } = await params;
    const body = await request.json();
    const liability = await recordLiabilityPayment(
      auth.user.societyId,
      id,
      { date: body.date, amount: body.amount, payingAccountId: body.payingAccountId, note: body.note },
      auth.user.userId,
    );
    return NextResponse.json({ liability });
  } catch (error) {
    if (
      error instanceof LiabilityServiceError ||
      error instanceof AccountingEngineError ||
      error instanceof AccountingEventError ||
      error instanceof PostingRuleError
    ) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("Record liability payment error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

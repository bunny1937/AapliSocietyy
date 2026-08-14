import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccountingClose } from "@/lib/authz";
import { runDepreciation, AssetServiceError } from "@/lib/services/AssetService";
import { AccountingEngineError } from "@/lib/accounting/AccountingEngine.js";
import { AccountingEventError } from "@/lib/accounting/events.js";
import { PostingRuleError } from "@/lib/accounting/postingRules/accountResolvers.js";

// POST /api/accounting/assets/[id]/depreciate — Admin/Secretary only.
// Body: { date?, periodMonths? }
export async function POST(request, { params }) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const asset = await runDepreciation(
      auth.user.societyId,
      id,
      { date: body.date, periodMonths: body.periodMonths },
      auth.user.userId,
    );
    return NextResponse.json({ asset });
  } catch (error) {
    if (
      error instanceof AssetServiceError ||
      error instanceof AccountingEngineError ||
      error instanceof AccountingEventError ||
      error instanceof PostingRuleError
    ) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("Run depreciation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

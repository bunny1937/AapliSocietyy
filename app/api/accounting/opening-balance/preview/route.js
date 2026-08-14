import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { authorizeAny } from "@/lib/rbac/authorize";
import {
  previewOpeningBalances,
  OpeningBalanceServiceError,
} from "@/lib/services/OpeningBalanceService";

// POST /api/accounting/opening-balance/preview — computes the balancing figure
// and proposed lines without posting. Body: { entries, openingFundAccountId }.
// Non-destructive (no write), gated by requireAccounting (not the stricter
// requireAccountingClose) — view-level is the right RBAC match, not manage.
export async function POST(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, [
    "statements.openingBalances.view",
    "society.systemTests.view",
  ]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json();
    const preview = await previewOpeningBalances(auth.user.societyId, {
      entries: body.entries,
      openingFundAccountId: body.openingFundAccountId,
    });
    return NextResponse.json({ preview });
  } catch (error) {
    if (error instanceof OpeningBalanceServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Opening balance preview error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

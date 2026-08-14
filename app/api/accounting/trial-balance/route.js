import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { authorizeAny } from "@/lib/rbac/authorize";
import { getTrialBalance, TrialBalanceServiceError } from "@/lib/services/TrialBalanceService";

// GET /api/accounting/trial-balance?financialYearId=
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  // Also read by the System Tests / Accounting Lab page — same
  // cross-page-dependency pattern as financial-years.
  const gate = await authorizeAny(request, [
    "statements.otherStatements.view",
    "society.systemTests.view",
  ]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const trialBalance = await getTrialBalance(auth.user.societyId, searchParams.get("financialYearId"));
    return NextResponse.json({ trialBalance });
  } catch (error) {
    if (error instanceof TrialBalanceServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Trial balance error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

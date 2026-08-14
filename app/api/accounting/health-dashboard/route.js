import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { getHealthDashboard, AccountingHealthServiceError } from "@/lib/services/AccountingHealthService";
import { TrialBalanceServiceError } from "@/lib/services/TrialBalanceService";
import { OpeningBalanceServiceError } from "@/lib/services/OpeningBalanceService";
import { FinancialClosingServiceError } from "@/lib/services/FinancialClosingService";
import { authorizeAny } from "@/lib/rbac/authorize";

// GET /api/accounting/health-dashboard?financialYearId=
// Read by generate-statements AND other-statements PageClient.js, not just
// the accounting-lab test tool.
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, [
    "statements.generateStatements.view",
    "statements.otherStatements.view",
    "society.systemTests.view",
  ]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const dashboard = await getHealthDashboard(auth.user.societyId, searchParams.get("financialYearId"));
    return NextResponse.json({ dashboard });
  } catch (error) {
    if (
      error instanceof AccountingHealthServiceError ||
      error instanceof TrialBalanceServiceError ||
      error instanceof OpeningBalanceServiceError ||
      error instanceof FinancialClosingServiceError
    ) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Health dashboard error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

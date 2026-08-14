import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { authorizeAny } from "@/lib/rbac/authorize";
import { getIncomeAndExpenditure, FinancialStatementsServiceError } from "@/lib/services/FinancialStatementsService";

// GET /api/accounting/financial-statements/income-expenditure?financialYearId=
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  // Also read by the System Tests / Accounting Lab page — same
  // cross-page-dependency pattern as financial-years.
  const gate = await authorizeAny(request, [
    "statements.incomeExpenditure.view",
    "society.systemTests.view",
  ]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const statement = await getIncomeAndExpenditure(auth.user.societyId, searchParams.get("financialYearId"));
    return NextResponse.json({ statement });
  } catch (error) {
    if (error instanceof FinancialStatementsServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Income & Expenditure statement error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
import { getReceiptsAndPayments, FinancialStatementsServiceError } from "@/lib/services/FinancialStatementsService";

// GET /api/accounting/financial-statements/receipts-payments?financialYearId=
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "statements.otherStatements.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const statement = await getReceiptsAndPayments(auth.user.societyId, searchParams.get("financialYearId"));
    return NextResponse.json({ statement });
  } catch (error) {
    if (error instanceof FinancialStatementsServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Receipts & Payments statement error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}

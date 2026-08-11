import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
import { exportTrialBalanceCsv, TrialBalanceServiceError } from "@/lib/services/TrialBalanceService";

// GET /api/accounting/trial-balance/export?financialYearId= — CSV download.
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "statements.otherStatements.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const financialYearId = searchParams.get("financialYearId");
    const csv = await exportTrialBalanceCsv(auth.user.societyId, financialYearId);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="trial-balance-${financialYearId}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof TrialBalanceServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Trial balance export error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}

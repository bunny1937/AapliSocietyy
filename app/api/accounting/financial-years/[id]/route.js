import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { authorizeAny } from "@/lib/rbac/authorize";
import {
  getFinancialYearById,
  FinancialYearServiceError,
} from "@/lib/services/FinancialYearService";

// Was gated on "society.systemTests.view" alone — same hole design doc §7
// "Fix 2" names for chart-of-accounts: no real accounting permission checked
// at all, and requireAccounting()'s own hat gate waves any RBAC staff token
// through by design (see its doc comment). Real permission checked now,
// systemTests kept alongside as the documented legacy fallback.
const VIEW = ["accounting.financialYears.view", "society.systemTests.view"];

// GET /api/accounting/financial-years/:id
export async function GET(request, ctx) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, VIEW);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const fy = await getFinancialYearById(auth.user.societyId, id);
    return NextResponse.json({ financialYear: fy });
  } catch (error) {
    if (error instanceof FinancialYearServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Get financial year error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

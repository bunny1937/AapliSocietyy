import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
import {
  getFinancialYearById,
  FinancialYearServiceError,
} from "@/lib/services/FinancialYearService";

// GET /api/accounting/financial-years/:id
export async function GET(request, ctx) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.view");
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
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}

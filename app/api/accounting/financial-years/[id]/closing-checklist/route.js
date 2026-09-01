import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { authorizeAny } from "@/lib/rbac/authorize";
import { getClosingChecklist, FinancialClosingServiceError } from "@/lib/services/FinancialClosingService";

// requireAccounting() alone waves any RBAC staff token through (see its own
// doc comment) — pairing with the real permission the same way chart-of-
// accounts/financial-years GET already were.
const VIEW = ["accounting.financialYears.view", "society.systemTests.view"];

// GET /api/accounting/financial-years/:id/closing-checklist
export async function GET(request, ctx) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, VIEW);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const checklist = await getClosingChecklist(auth.user.societyId, id);
    return NextResponse.json({ checklist });
  } catch (error) {
    if (error instanceof FinancialClosingServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Closing checklist error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

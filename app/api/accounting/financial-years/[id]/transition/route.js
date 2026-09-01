import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccountingClose } from "@/lib/authz";
import { authorizeAny } from "@/lib/rbac/authorize";
import { FinancialYearServiceError } from "@/lib/services/FinancialYearService";
import {
  advanceFinancialYear,
  FinancialClosingServiceError,
} from "@/lib/services/FinancialClosingService";

// requireAccountingClose() alone waves any RBAC staff token through (see its
// own doc comment) — this route writes state that closes a financial period,
// so it gets the real permission pairing the same way chart-of-accounts'
// write routes already do.
const CLOSE = ["accounting.financialYears.close", "society.systemTests.update"];

// POST /api/accounting/financial-years/:id/transition
// Advances a Financial Year exactly one step forward through its 5-state
// workflow (Draft -> Reviewed -> Auditor Review -> Approved -> Locked).
// Admin/Secretary only — see docs/accounting-system-ARD.md §6.6. The final
// Approved -> Locked step is additionally gated by the Closing Wizard's
// checklist (Phase 2.17, §8) via advanceFinancialYear().
export async function POST(request, ctx) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, CLOSE);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const { note } = await request.json().catch(() => ({}));
    const fy = await advanceFinancialYear(auth.user.societyId, id, {
      byUserId: auth.user.userId,
      byRole: auth.user.role,
      note,
    });
    return NextResponse.json({ financialYear: fy });
  } catch (error) {
    if (error instanceof FinancialYearServiceError || error instanceof FinancialClosingServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Transition financial year error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

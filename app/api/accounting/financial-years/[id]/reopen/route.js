import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireSuperAdmin } from "@/lib/authz";
import {
  reopenFinancialYear,
  FinancialYearServiceError,
} from "@/lib/services/FinancialYearService";

// POST /api/accounting/financial-years/:id/reopen
// SuperAdmin-only exception path — reopens a Locked Financial Year back to
// Draft. Matches the original spec's "Year reopening" exception-handling
// requirement (docs/accounting-system-ARD.md §6.6). SuperAdmin tokens are
// not society-scoped (a separate auth domain — see ARD §2.3), so societyId
// must be supplied in the request body.
export async function POST(request, ctx) {
  const auth = requireSuperAdmin(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const { societyId, note } = await request.json().catch(() => ({}));
    if (!societyId) {
      return NextResponse.json({ error: "societyId is required" }, { status: 400 });
    }
    const fy = await reopenFinancialYear({
      societyId,
      id,
      byUserId: auth.admin.userId,
      byRole: "SuperAdmin",
      note,
    });
    return NextResponse.json({ financialYear: fy });
  } catch (error) {
    if (error instanceof FinancialYearServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Reopen financial year error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

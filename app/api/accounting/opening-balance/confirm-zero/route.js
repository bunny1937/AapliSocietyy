import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccountingClose } from "@/lib/authz";
import {
  confirmZeroOpeningBalance,
  OpeningBalanceServiceError,
} from "@/lib/services/OpeningBalanceService";
import { authorizeAny } from "@/lib/rbac/authorize";

// POST /api/accounting/opening-balance/confirm-zero
// ----------------------------------------------------------------------------
// The other answer to "this Financial Year already has entries but no
// opening balance": nothing was ever missing — the year genuinely started
// from zero. No voucher to write, just marks the step done so the checklist
// and the setup banner stop asking for a figure that never existed.
export async function POST(request) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, [
    "statements.openingBalances.update",
    "society.systemTests.update",
  ]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json();
    const result = await confirmZeroOpeningBalance(auth.user.societyId, body.financialYearId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof OpeningBalanceServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Confirm zero opening balance error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

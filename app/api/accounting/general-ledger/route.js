import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
import {
  getAccountLedger,
  GeneralLedgerServiceError,
} from "@/lib/services/GeneralLedgerService";

// GET /api/accounting/general-ledger?accountId=&financialYearId=&dateFrom=&dateTo=
// Returns the full ledger (opening/movements/closing) for one account.
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("accountId");
    if (!accountId) {
      return NextResponse.json({ error: "accountId is required" }, { status: 400 });
    }
    const ledger = await getAccountLedger(auth.user.societyId, accountId, {
      financialYearId: searchParams.get("financialYearId") || undefined,
      dateFrom: searchParams.get("dateFrom") || undefined,
      dateTo: searchParams.get("dateTo") || undefined,
    });
    return NextResponse.json({ ledger });
  } catch (error) {
    if (error instanceof GeneralLedgerServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("General ledger error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { authorizeAny } from "@/lib/rbac/authorize";
import {
  getAccountLedger,
  GeneralLedgerServiceError,
} from "@/lib/services/GeneralLedgerService";

// Was gated on "society.systemTests.view" alone — same class of hole design
// doc §7 "Fix 2" names elsewhere. Paired with the real permissions that
// actually reach this data: Trial Balance's own view permission (this is
// its drill-through) and the Auditor workspace's.
const VIEW = ["statements.otherStatements.view", "auditor.workspace.view", "society.systemTests.view"];

// GET /api/accounting/general-ledger?accountId=&financialYearId=&dateFrom=&dateTo=
// Returns the full ledger (opening/movements/closing) for one account.
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, VIEW);
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

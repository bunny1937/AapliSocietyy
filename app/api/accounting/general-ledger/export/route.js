import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { authorizeAny } from "@/lib/rbac/authorize";
import {
  exportAccountLedgerCsv,
  GeneralLedgerServiceError,
} from "@/lib/services/GeneralLedgerService";

const VIEW = ["statements.otherStatements.view", "auditor.workspace.view", "society.systemTests.view"];

// GET /api/accounting/general-ledger/export?accountId=&financialYearId=&dateFrom=&dateTo=
// Streams the account ledger as a CSV download.
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
    const csv = await exportAccountLedgerCsv(auth.user.societyId, accountId, {
      financialYearId: searchParams.get("financialYearId") || undefined,
      dateFrom: searchParams.get("dateFrom") || undefined,
      dateTo: searchParams.get("dateTo") || undefined,
    });
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ledger-${accountId}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof GeneralLedgerServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("General ledger export error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

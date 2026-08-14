import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { getLedgerSummary } from "@/lib/services/GeneralLedgerService";
import { authorize } from "@/lib/rbac/authorize";

// GET /api/accounting/general-ledger/summary?financialYearId=
// Net balance per account (GL navigation index — not the authoritative Trial Balance).
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const summary = await getLedgerSummary(auth.user.societyId, {
      financialYearId: searchParams.get("financialYearId") || undefined,
    });
    return NextResponse.json({ summary });
  } catch (error) {
    console.error("General ledger summary error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

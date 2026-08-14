import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import {
  getReconciliationSummary,
  listUnmatchedJournalLines,
  BankReconciliationServiceError,
} from "@/lib/services/BankReconciliationService";
import { BankAccountServiceError } from "@/lib/services/BankAccountService";

// GET /api/accounting/bank-accounts/[id]/reconciliation?asOf=&include=unmatchedJournalLines
export async function GET(request, { params }) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const summary = await getReconciliationSummary(auth.user.societyId, id, {
      asOf: searchParams.get("asOf") || undefined,
    });
    let unmatchedJournalLines;
    if (searchParams.get("include") === "unmatchedJournalLines") {
      unmatchedJournalLines = await listUnmatchedJournalLines(auth.user.societyId, id);
    }
    return NextResponse.json({ summary, unmatchedJournalLines });
  } catch (error) {
    if (error instanceof BankReconciliationServiceError || error instanceof BankAccountServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Reconciliation summary error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

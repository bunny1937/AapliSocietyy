import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { createManualMatch, BankReconciliationServiceError } from "@/lib/services/BankReconciliationService";
import { authorizeAny } from "@/lib/rbac/authorize";

const MATCH = ["accounting.bankAccounts.match", "society.systemTests.update"];

// POST /api/accounting/reconciliation-matches — manually match one statement line to one journal line.
// Body: { bankAccountId, bankStatementLineId, journalLineId, note? }
export async function POST(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, MATCH);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json();
    const match = await createManualMatch(
      auth.user.societyId,
      body.bankAccountId,
      { bankStatementLineId: body.bankStatementLineId, journalLineId: body.journalLineId, note: body.note },
      auth.user.userId,
    );
    return NextResponse.json({ match }, { status: 201 });
  } catch (error) {
    if (error instanceof BankReconciliationServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Create manual match error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

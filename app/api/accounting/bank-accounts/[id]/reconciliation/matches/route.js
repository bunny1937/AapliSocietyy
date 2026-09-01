import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { authorizeAny } from "@/lib/rbac/authorize";
import { listMatches, BankReconciliationServiceError } from "@/lib/services/BankReconciliationService";
import { BankAccountServiceError } from "@/lib/services/BankAccountService";

const VIEW = ["accounting.bankAccounts.view", "society.systemTests.view"];

// GET /api/accounting/bank-accounts/[id]/reconciliation/matches?status=Pending
export async function GET(request, { params }) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, VIEW);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const matches = await listMatches(auth.user.societyId, id, { status: searchParams.get("status") || undefined });
    return NextResponse.json({ matches });
  } catch (error) {
    if (error instanceof BankReconciliationServiceError || error instanceof BankAccountServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("List matches error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

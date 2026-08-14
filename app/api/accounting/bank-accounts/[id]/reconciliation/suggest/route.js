import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { suggestMatches, BankReconciliationServiceError } from "@/lib/services/BankReconciliationService";
import { BankAccountServiceError } from "@/lib/services/BankAccountService";

// POST /api/accounting/bank-accounts/[id]/reconciliation/suggest — auto-proposes Pending matches.
export async function POST(request, { params }) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { id } = await params;
    const result = await suggestMatches(auth.user.societyId, id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BankReconciliationServiceError || error instanceof BankAccountServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Suggest matches error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

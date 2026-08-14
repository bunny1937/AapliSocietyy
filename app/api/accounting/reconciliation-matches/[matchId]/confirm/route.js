import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { confirmMatch, BankReconciliationServiceError } from "@/lib/services/BankReconciliationService";

// POST /api/accounting/reconciliation-matches/[matchId]/confirm — confirms a Pending suggested match.
export async function POST(request, { params }) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { matchId } = await params;
    const match = await confirmMatch(auth.user.societyId, matchId, auth.user.userId);
    return NextResponse.json({ match });
  } catch (error) {
    if (error instanceof BankReconciliationServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Confirm match error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { undoMatch, BankReconciliationServiceError } from "@/lib/services/BankReconciliationService";
import { authorize } from "@/lib/rbac/authorize";

// DELETE /api/accounting/reconciliation-matches/[matchId] — undo a match (Pending or Matched).
export async function DELETE(request, { params }) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.update");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { matchId } = await params;
    const result = await undoMatch(auth.user.societyId, matchId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BankReconciliationServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Undo match error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { getBankAccountById, BankAccountServiceError } from "@/lib/services/BankAccountService";
import { authorizeAny } from "@/lib/rbac/authorize";

const VIEW = ["accounting.bankAccounts.view", "society.systemTests.view"];

// GET /api/accounting/bank-accounts/[id]
export async function GET(request, { params }) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, VIEW);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await params;
    const bankAccount = await getBankAccountById(auth.user.societyId, id);
    return NextResponse.json({ bankAccount });
  } catch (error) {
    if (error instanceof BankAccountServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Get bank account error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

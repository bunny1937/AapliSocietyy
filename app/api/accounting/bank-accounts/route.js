import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting, requireAccountingClose } from "@/lib/authz";
import { createBankAccount, listBankAccounts, BankAccountServiceError } from "@/lib/services/BankAccountService";
import { authorize } from "@/lib/rbac/authorize";

// GET /api/accounting/bank-accounts?includeInactive=true
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const bankAccounts = await listBankAccounts(auth.user.societyId, {
      includeInactive: searchParams.get("includeInactive") === "true",
    });
    return NextResponse.json({ bankAccounts });
  } catch (error) {
    console.error("List bank accounts error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}

// POST /api/accounting/bank-accounts — Admin/Secretary only.
export async function POST(request) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.update");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json();
    const bankAccount = await createBankAccount(auth.user.societyId, body, auth.user.userId);
    return NextResponse.json({ bankAccount }, { status: 201 });
  } catch (error) {
    if (error instanceof BankAccountServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Create bank account error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}

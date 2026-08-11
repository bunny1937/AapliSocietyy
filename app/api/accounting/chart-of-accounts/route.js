import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting, requireAccountingClose } from "@/lib/authz";
import { authorize, authorizeAny } from "@/lib/rbac/authorize";
import {
  createAccount,
  listAccounts,
  ChartOfAccountServiceError,
} from "@/lib/services/ChartOfAccountService";

// GET /api/accounting/chart-of-accounts?type=Asset&includeInactive=true
// Also read by app/admin/opening-balances/PageClient.js (needs the account
// list to build its entry form) — not just the accounting-lab test tool.
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, [
    "statements.openingBalances.view",
    "society.systemTests.view",
  ]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const accounts = await listAccounts(auth.user.societyId, {
      type: searchParams.get("type") || undefined,
      includeInactive: searchParams.get("includeInactive") === "true",
    });
    return NextResponse.json({ accounts });
  } catch (error) {
    console.error("List chart of accounts error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}

// POST /api/accounting/chart-of-accounts — Admin/Secretary only.
export async function POST(request) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.update");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json();
    const account = await createAccount({ ...body, societyId: auth.user.societyId, createdBy: auth.user.userId });
    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    if (error instanceof ChartOfAccountServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Create chart of account error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}

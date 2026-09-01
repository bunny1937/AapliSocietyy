import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting, requireAccountingClose } from "@/lib/authz";
import { authorizeAny } from "@/lib/rbac/authorize";
import {
  createAccount,
  listAccounts,
  listAccountsWithLock,
  ChartOfAccountServiceError,
} from "@/lib/services/ChartOfAccountService";
import { recordAdopted } from "@/lib/accounting/chartProfile";
import { STANDARD_ACCOUNTS } from "@/lib/accounting/standardAccounts";

// GET /api/accounting/chart-of-accounts?type=Asset&includeInactive=true
// Also read by app/admin/opening-balances/PageClient.js (needs the account
// list to build its entry form) — not just the accounting-lab test tool.
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, [
    "accounting.chartOfAccounts.view",
    "accounting.overview.view",
    "statements.openingBalances.view",
    "accounting.schedules.view",
    "accounting.journalEntries.view",
    "accounting.auditTrail.view",
    "accounting.assets.view",
    "society.systemTests.view",
  ]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const opts = {
      type: searchParams.get("type") || undefined,
      includeInactive: searchParams.get("includeInactive") === "true",
    };
    // The Heads page needs the lock matrix for every row up front (design
    // doc §7/§9's <GuardedAction>) — one bulk call instead of N+1 per row.
    const accounts = searchParams.get("withLock") === "1"
      ? await listAccountsWithLock(auth.user.societyId, opts)
      : await listAccounts(auth.user.societyId, opts);
    return NextResponse.json({ accounts });
  } catch (error) {
    console.error("List chart of accounts error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST /api/accounting/chart-of-accounts — Admin/Secretary only.
export async function POST(request) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, [
    "accounting.chartOfAccounts.create",
    "society.systemTests.update",
  ]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json();
    const account = await createAccount({ ...body, societyId: auth.user.societyId, createdBy: auth.user.userId });
    if (STANDARD_ACCOUNTS.some((a) => a.code === account.code)) {
      await recordAdopted(auth.user.societyId, account.code).catch(() => {});
    }
    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    if (error instanceof ChartOfAccountServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Create chart of account error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

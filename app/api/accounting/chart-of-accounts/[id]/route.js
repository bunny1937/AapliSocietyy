import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting, requireAccountingClose } from "@/lib/authz";
import { authorizeAny } from "@/lib/rbac/authorize";
import {
  getAccountById,
  updateAccount,
  deleteAccount,
  getAccountLockContext,
  computeLockLevel,
  ChartOfAccountServiceError,
} from "@/lib/services/ChartOfAccountService";

// Used to run on "society.systemTests.view/update" alone — the exact hole
// design doc §7 "Fix 2" names: anyone granted "system tests" could read or
// rewrite the chart of accounts with no real accounting permission at all.
// Real accounting.chartOfAccounts.* checked now, systemTests kept alongside
// only as the documented legacy fallback (see setup/run/route.js's comment —
// same deferral, not removed until Phase 6).
const VIEW = ["accounting.chartOfAccounts.view", "society.systemTests.view"];
const UPDATE = ["accounting.chartOfAccounts.update", "society.systemTests.update"];
const DELETE_PERMS = ["accounting.chartOfAccounts.delete", "society.systemTests.update"];

export async function GET(request, ctx) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, VIEW);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const account = await getAccountById(auth.user.societyId, id);
    const lockCtx = await getAccountLockContext(auth.user.societyId, account);
    return NextResponse.json({ account, lock: computeLockLevel(lockCtx), journalLineCount: lockCtx.journalLineCount });
  } catch (error) {
    if (error instanceof ChartOfAccountServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Get chart of account error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// PATCH /api/accounting/chart-of-accounts/:id — Admin/Secretary only.
export async function PATCH(request, ctx) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, UPDATE);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const patch = await request.json();
    const account = await updateAccount(auth.user.societyId, id, patch);
    return NextResponse.json({ account });
  } catch (error) {
    if (error instanceof ChartOfAccountServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Update chart of account error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE /api/accounting/chart-of-accounts/:id — Admin/Secretary only.
// The lock matrix (lib/accounting/lockMatrix.js) decides, server-side,
// whether this account is actually deletable — a client that skipped the T3
// refusal screen gets refused here too, not silently allowed through.
export async function DELETE(request, ctx) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, DELETE_PERMS);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const account = await deleteAccount(auth.user.societyId, id);
    return NextResponse.json({ account });
  } catch (error) {
    if (error instanceof ChartOfAccountServiceError) {
      return NextResponse.json({ error: error.message, refusal: error.refusal || null }, { status: error.status });
    }
    console.error("Delete chart of account error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

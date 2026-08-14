import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting, requireAccountingClose } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
import {
  getAccountById,
  updateAccount,
  ChartOfAccountServiceError,
} from "@/lib/services/ChartOfAccountService";

export async function GET(request, ctx) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const account = await getAccountById(auth.user.societyId, id);
    return NextResponse.json({ account });
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
  const gate = await authorize(request, "society.systemTests.update");
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

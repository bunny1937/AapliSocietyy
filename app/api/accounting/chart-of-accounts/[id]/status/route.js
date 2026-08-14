import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccountingClose } from "@/lib/authz";
import {
  setAccountActive,
  setAccountLocked,
  ChartOfAccountServiceError,
} from "@/lib/services/ChartOfAccountService";

// PATCH /api/accounting/chart-of-accounts/:id/status
// Body: { isActive?: boolean, isLocked?: boolean } — Admin/Secretary only.
export async function PATCH(request, ctx) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const { isActive, isLocked } = await request.json();
    let account;
    if (isActive !== undefined) {
      account = await setAccountActive(auth.user.societyId, id, isActive);
    }
    if (isLocked !== undefined) {
      account = await setAccountLocked(auth.user.societyId, id, isLocked);
    }
    if (!account) {
      return NextResponse.json({ error: "isActive or isLocked is required" }, { status: 400 });
    }
    return NextResponse.json({ account });
  } catch (error) {
    if (error instanceof ChartOfAccountServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Update chart of account status error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

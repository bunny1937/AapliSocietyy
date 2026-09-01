import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccountingClose } from "@/lib/authz";
import { authorizeAny } from "@/lib/rbac/authorize";
import {
  setAccountActive,
  setAccountLocked,
  ChartOfAccountServiceError,
} from "@/lib/services/ChartOfAccountService";

// PATCH /api/accounting/chart-of-accounts/:id/status
// Body: { isActive?: boolean, isLocked?: boolean } — Admin/Secretary only.
//
// Used to run on requireAccountingClose() alone — that hat check waves
// through any RBAC staff token on the documented assumption that a real
// authorize() call follows it. None did here, so locking/unlocking or
// deactivating a head bypassed RBAC entirely. Gated the same way its sibling
// PATCH /[id] route is.
export async function PATCH(request, ctx) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, [
    "accounting.chartOfAccounts.update",
    "accounting.chartOfAccounts.deactivate",
  ]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const { isActive, isLocked, reason } = await request.json();
    let account;
    if (isActive !== undefined) {
      account = await setAccountActive(auth.user.societyId, id, isActive, { reason });
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
      // T3 refusals carry the doc's "what you tried / why not / what instead"
      // shape (§7 T3 copy rule) so the page can render it, not just the bare message.
      return NextResponse.json({ error: error.message, refusal: error.refusal || null }, { status: error.status });
    }
    console.error("Update chart of account status error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

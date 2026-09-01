import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { reverseVoucher, JournalEntryServiceError } from "@/lib/services/JournalEntryService";
import { authorizeAny } from "@/lib/rbac/authorize";

// POST /api/accounting/vouchers/:id/reverse
// Body: { reason } — creates an offsetting reversal voucher + journal entry.
export async function POST(request, ctx) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  // Phase 5. This route previously carried only the legacy hat check, and
  // that helper waves ANY RBAC staff token through on the documented
  // assumption that a real authorize() call follows it. None did.
  const gate = await authorizeAny(request, [
    "accounting.vouchers.reverse",
    "society.systemTests.update",
  ]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const { reason } = await request.json().catch(() => ({}));
    const result = await reverseVoucher(auth.user.societyId, id, {
      reason,
      actorUserId: auth.user.userId,
    });
    return NextResponse.json(
      { reversalVoucher: result.reversalVoucher, reversalEntry: result.reversalEntry },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof JournalEntryServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Reverse voucher error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

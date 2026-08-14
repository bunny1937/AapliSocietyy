import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { reverseVoucher, JournalEntryServiceError } from "@/lib/services/JournalEntryService";

// POST /api/accounting/vouchers/:id/reverse
// Body: { reason } — creates an offsetting reversal voucher + journal entry.
export async function POST(request, ctx) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
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

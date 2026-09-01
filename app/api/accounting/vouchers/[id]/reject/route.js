import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccountingClose } from "@/lib/authz";
import { rejectVoucher, VoucherServiceError } from "@/lib/services/VoucherService";
import { authorizeAny } from "@/lib/rbac/authorize";

export async function POST(request, ctx) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  // Phase 5. This route previously carried only the legacy hat check, and
  // that helper waves ANY RBAC staff token through on the documented
  // assumption that a real authorize() call follows it. None did.
  const gate = await authorizeAny(request, [
    "accounting.vouchers.reject",
    "society.systemTests.update",
  ]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const { reason } = await request.json().catch(() => ({}));
    const voucher = await rejectVoucher(auth.user.societyId, id, {
      actorUserId: auth.user.userId,
      reason,
    });
    return NextResponse.json({ voucher });
  } catch (error) {
    if (error instanceof VoucherServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Reject voucher error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccountingClose } from "@/lib/authz";
import { rejectVoucher, VoucherServiceError } from "@/lib/services/VoucherService";

export async function POST(request, ctx) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
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

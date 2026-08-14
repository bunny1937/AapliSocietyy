import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccountingClose } from "@/lib/authz";
import { approveVoucher, VoucherServiceError } from "@/lib/services/VoucherService";

// Admin/Secretary only — approving a voucher is a higher-stakes action than
// day-to-day entry creation.
export async function POST(request, ctx) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const voucher = await approveVoucher(auth.user.societyId, id, {
      actorUserId: auth.user.userId,
    });
    return NextResponse.json({ voucher });
  } catch (error) {
    if (error instanceof VoucherServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Approve voucher error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { getVoucherById, VoucherServiceError } from "@/lib/services/VoucherService";
import { authorizeAny } from "@/lib/rbac/authorize";

export async function GET(request, ctx) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, [
    "accounting.vouchers.view",
    "society.systemTests.view",
  ]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const voucher = await getVoucherById(auth.user.societyId, id);
    return NextResponse.json({ voucher });
  } catch (error) {
    if (error instanceof VoucherServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Get voucher error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

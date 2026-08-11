import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
import {
  createDraftVoucher,
  listVouchers,
  VoucherServiceError,
} from "@/lib/services/VoucherService";

// GET /api/accounting/vouchers?financialYearId=&status=&voucherType=&sourceModule=
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const vouchers = await listVouchers(auth.user.societyId, {
      financialYearId: searchParams.get("financialYearId") || undefined,
      status: searchParams.get("status") || undefined,
      voucherType: searchParams.get("voucherType") || undefined,
      sourceModule: searchParams.get("sourceModule") || undefined,
    });
    return NextResponse.json({ vouchers });
  } catch (error) {
    console.error("List vouchers error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}

// POST /api/accounting/vouchers — creates a Draft voucher header (no Journal
// lines yet — those are attached by the Accounting/Journal Engine, Phases
// 2.6/2.8). Manual voucher creation always uses sourceModule: "Manual".
export async function POST(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.update");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json();
    const voucher = await createDraftVoucher({
      societyId: auth.user.societyId,
      financialYearId: body.financialYearId,
      voucherType: body.voucherType,
      date: body.date,
      narration: body.narration,
      sourceModule: body.sourceModule || "Manual",
      sourceRef: body.sourceRef,
      createdBy: auth.user.userId,
    });
    return NextResponse.json({ voucher }, { status: 201 });
  } catch (error) {
    if (error instanceof VoucherServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Create voucher error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}

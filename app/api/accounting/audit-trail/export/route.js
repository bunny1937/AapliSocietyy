import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAuditor } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
import { getAuditTrail } from "@/lib/services/AuditorService";
import { generateAuditTrailPdf } from "@/lib/accounting/auditTrailPdf";
import Voucher from "@/models/Voucher";
import FinancialYear from "@/models/FinancialYear";
import User from "@/models/User";

// GET /api/accounting/audit-trail/export?financialYearId= — PDF download.
export async function GET(request) {
  const auth = requireAuditor(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "audit.log.read");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const financialYearId = searchParams.get("financialYearId") || undefined;

    const trail = await getAuditTrail(auth.user.societyId, { financialYearId });

    const voucherIds = [...new Set(trail.flatMap((t) => [String(t.originalVoucherId), String(t.adjustmentVoucherId)]))];
    const userIds = [...new Set(trail.map((t) => String(t.adjustedBy)))];
    const [vouchers, users, fy] = await Promise.all([
      Voucher.find({ _id: { $in: voucherIds } }).select("voucherNumber").lean(),
      User.find({ _id: { $in: userIds } }).select("name").lean(),
      financialYearId ? FinancialYear.findById(financialYearId).select("label").lean() : null,
    ]);
    const voucherNumberById = new Map(vouchers.map((v) => [String(v._id), v.voucherNumber]));
    const nameById = new Map(users.map((u) => [String(u._id), u.name]));

    const entries = trail.map((t) => ({
      ...t,
      originalVoucherNumber: voucherNumberById.get(String(t.originalVoucherId)),
      adjustmentVoucherNumber: voucherNumberById.get(String(t.adjustmentVoucherId)),
      adjustedByName: nameById.get(String(t.adjustedBy)),
    }));

    const pdfBytes = await generateAuditTrailPdf(entries, { financialYearLabel: fy?.label });
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="auditor-adjustment-history.pdf"',
      },
    });
  } catch (error) {
    console.error("Export audit trail error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}

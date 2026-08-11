import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAuditor, requireAuditorWrite } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
import { getAuditTrail, createAdjustment, AuditorServiceError } from "@/lib/services/AuditorService";
import { AccountingEngineError } from "@/lib/accounting/AccountingEngine.js";
import { AccountingEventError } from "@/lib/accounting/events.js";
import { PostingRuleError } from "@/lib/accounting/postingRules/accountResolvers.js";

// GET /api/accounting/audit-trail?voucherId=&financialYearId=
export async function GET(request) {
  const auth = requireAuditor(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "audit.log.read");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const trail = await getAuditTrail(auth.user.societyId, {
      voucherId: searchParams.get("voucherId") || undefined,
      financialYearId: searchParams.get("financialYearId") || undefined,
    });
    return NextResponse.json({ trail });
  } catch (error) {
    console.error("Get audit trail error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}

// POST /api/accounting/audit-trail — Auditor Mode adjustment. Admin/Secretary/Auditor.
// Body: { originalVoucherId, lines, reason, date? }
export async function POST(request) {
  const auth = requireAuditorWrite(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "audit.report.create");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json();
    const result = await createAdjustment(
      auth.user.societyId,
      { originalVoucherId: body.originalVoucherId, lines: body.lines, reason: body.reason, date: body.date },
      auth.user.userId,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (
      error instanceof AuditorServiceError ||
      error instanceof AccountingEngineError ||
      error instanceof AccountingEventError ||
      error instanceof PostingRuleError
    ) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("Create audit adjustment error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}

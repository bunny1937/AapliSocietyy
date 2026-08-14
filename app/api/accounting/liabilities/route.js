import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting, requireAccountingClose } from "@/lib/authz";
import {
  incurLiability,
  listLiabilities,
  LiabilityServiceError,
} from "@/lib/services/LiabilityService";
import { AccountingEngineError } from "@/lib/accounting/AccountingEngine.js";
import { AccountingEventError } from "@/lib/accounting/events.js";
import { PostingRuleError } from "@/lib/accounting/postingRules/accountResolvers.js";
import { authorize } from "@/lib/rbac/authorize";

function mapError(error) {
  if (
    error instanceof LiabilityServiceError ||
    error instanceof AccountingEngineError ||
    error instanceof AccountingEventError ||
    error instanceof PostingRuleError
  ) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return null;
}

// GET /api/accounting/liabilities?status=Open&type=Loan
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const liabilities = await listLiabilities(auth.user.societyId, {
      status: searchParams.get("status") || undefined,
      type: searchParams.get("type") || undefined,
    });
    return NextResponse.json({ liabilities });
  } catch (error) {
    console.error("List liabilities error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST /api/accounting/liabilities — record + post a liability incurrence. Admin/Secretary only.
export async function POST(request) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.update");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json();
    const liability = await incurLiability(auth.user.societyId, body, auth.user.userId);
    return NextResponse.json({ liability }, { status: 201 });
  } catch (error) {
    const mapped = mapError(error);
    if (mapped) return mapped;
    console.error("Incur liability error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

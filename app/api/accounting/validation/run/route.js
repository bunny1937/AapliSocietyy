import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { runValidations } from "@/lib/services/ValidationRuleService";
import { authorizeAny } from "@/lib/rbac/authorize";

// Same real permission the Trial Balance / general-ledger routes gate on —
// this is the same book-checks data the Hub's "Are the books correct?"
// section and Auditor's Position tab both surface.
const VIEW = ["statements.otherStatements.view", "auditor.workspace.view", "society.systemTests.view"];

// GET /api/accounting/validation/run?financialYearId=
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, VIEW);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const result = await runValidations(auth.user.societyId, {
      financialYearId: searchParams.get("financialYearId") || undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Run validations error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { runValidations } from "@/lib/services/ValidationRuleService";
import { authorize } from "@/lib/rbac/authorize";

// GET /api/accounting/validation/run?financialYearId=
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.view");
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

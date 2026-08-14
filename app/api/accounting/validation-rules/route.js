import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting, requireAccountingClose } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
import {
  listValidationRules,
  createValidationRule,
  ValidationRuleServiceError,
} from "@/lib/services/ValidationRuleService";

// GET /api/accounting/validation-rules?onlyOwn=true
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const rules = await listValidationRules(auth.user.societyId, {
      onlyOwn: searchParams.get("onlyOwn") === "true",
    });
    return NextResponse.json({ validationRules: rules });
  } catch (error) {
    console.error("List validation rules error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST /api/accounting/validation-rules — per-society override. Admin/Secretary only.
export async function POST(request) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.update");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json();
    const rule = await createValidationRule(auth.user.societyId, body, auth.user.userId);
    return NextResponse.json({ validationRule: rule }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationRuleServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Create validation rule error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

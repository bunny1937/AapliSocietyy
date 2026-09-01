import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccountingClose } from "@/lib/authz";
import { seedDefaultValidationRules } from "@/lib/services/ValidationRuleService";
import { authorizeAny } from "@/lib/rbac/authorize";

const SEED = ["accounting.validationRules.seedDefaults", "society.systemTests.update"];

// POST /api/accounting/validation-rules/seed-defaults
// Idempotently (re)seeds the shared default-tier validation rules. Admin/Secretary only.
export async function POST(request) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, SEED);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const result = await seedDefaultValidationRules();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Seed default validation rules error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

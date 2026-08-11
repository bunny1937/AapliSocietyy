import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccountingClose } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
import {
  seedDefaultPostingRules,
  PostingRuleServiceError,
} from "@/lib/services/PostingRuleService";

// POST /api/accounting/posting-rules/seed-defaults
// Idempotently (re)seeds the shared default-tier posting rules. Admin/Secretary
// only. Default rules are shared across societies (societyId: null), so this
// is really a system action any admin can trigger to ensure defaults exist.
export async function POST(request) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.update");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const result = await seedDefaultPostingRules();
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PostingRuleServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Seed default posting rules error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}

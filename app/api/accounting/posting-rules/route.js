import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting, requireAccountingClose } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
import {
  listPostingRules,
  createPostingRule,
  PostingRuleServiceError,
} from "@/lib/services/PostingRuleService";

// GET /api/accounting/posting-rules?eventType=&onlyOwn=true
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const rules = await listPostingRules(auth.user.societyId, {
      eventType: searchParams.get("eventType") || undefined,
      onlyOwn: searchParams.get("onlyOwn") === "true",
    });
    return NextResponse.json({ postingRules: rules });
  } catch (error) {
    console.error("List posting rules error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}

// POST /api/accounting/posting-rules — create a per-society override. Admin/Secretary only.
export async function POST(request) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.update");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json();
    const rule = await createPostingRule(auth.user.societyId, body, auth.user.userId);
    return NextResponse.json({ postingRule: rule }, { status: 201 });
  } catch (error) {
    if (error instanceof PostingRuleServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Create posting rule error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}

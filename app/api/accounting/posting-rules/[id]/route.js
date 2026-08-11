import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting, requireAccountingClose } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
import {
  getPostingRuleById,
  updatePostingRule,
  deletePostingRule,
  PostingRuleServiceError,
} from "@/lib/services/PostingRuleService";

export async function GET(request, ctx) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const rule = await getPostingRuleById(auth.user.societyId, id);
    return NextResponse.json({ postingRule: rule });
  } catch (error) {
    if (error instanceof PostingRuleServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Get posting rule error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}

// PATCH /api/accounting/posting-rules/:id — Admin/Secretary only.
export async function PATCH(request, ctx) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.update");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const patch = await request.json();
    const rule = await updatePostingRule(auth.user.societyId, id, patch);
    return NextResponse.json({ postingRule: rule });
  } catch (error) {
    if (error instanceof PostingRuleServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Update posting rule error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}

// DELETE /api/accounting/posting-rules/:id — Admin/Secretary only (soft delete).
export async function DELETE(request, ctx) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.update");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const result = await deletePostingRule(auth.user.societyId, id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PostingRuleServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Delete posting rule error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}

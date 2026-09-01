import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccountingClose } from "@/lib/authz";
import { disposeAsset, AssetServiceError } from "@/lib/services/AssetService";
import { AccountingEngineError } from "@/lib/accounting/AccountingEngine.js";
import { AccountingEventError } from "@/lib/accounting/events.js";
import { PostingRuleError } from "@/lib/accounting/postingRules/accountResolvers.js";
import { authorizeAny } from "@/lib/rbac/authorize";

// POST /api/accounting/assets/[id]/dispose — Admin/Secretary only.
// Body: { date?, proceeds?, disposalAccountId?, gainLossAccountId?, note? }
export async function POST(request, { params }) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  // Phase 7. This route previously carried only the legacy hat check, and
  // that helper waves ANY RBAC staff token through on the documented
  // assumption that a real authorize() call follows it. None did.
  const gate = await authorizeAny(request, [
    "accounting.assets.dispose",
    "society.systemTests.update",
  ]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await params;
    const body = await request.json();
    const asset = await disposeAsset(
      auth.user.societyId,
      id,
      {
        date: body.date,
        proceeds: body.proceeds,
        disposalAccountId: body.disposalAccountId,
        gainLossAccountId: body.gainLossAccountId,
        note: body.note,
      },
      auth.user.userId,
    );
    return NextResponse.json({ asset });
  } catch (error) {
    if (
      error instanceof AssetServiceError ||
      error instanceof AccountingEngineError ||
      error instanceof AccountingEventError ||
      error instanceof PostingRuleError
    ) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("Dispose asset error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

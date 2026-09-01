import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting, requireAccountingClose } from "@/lib/authz";
import {
  registerAsset,
  listAssets,
  AssetServiceError,
} from "@/lib/services/AssetService";
import { AccountingEngineError } from "@/lib/accounting/AccountingEngine.js";
import { AccountingEventError } from "@/lib/accounting/events.js";
import { PostingRuleError } from "@/lib/accounting/postingRules/accountResolvers.js";
import { authorizeAny } from "@/lib/rbac/authorize";

function mapError(error) {
  if (
    error instanceof AssetServiceError ||
    error instanceof AccountingEngineError ||
    error instanceof AccountingEventError ||
    error instanceof PostingRuleError
  ) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return null;
}

// GET /api/accounting/assets?status=Active&category=Lift
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, [
    "accounting.assets.view",
    "society.systemTests.view",
  ]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const assets = await listAssets(auth.user.societyId, {
      status: searchParams.get("status") || undefined,
      category: searchParams.get("category") || undefined,
    });
    return NextResponse.json({ assets });
  } catch (error) {
    console.error("List assets error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST /api/accounting/assets — register + post an asset purchase. Admin/Secretary only.
export async function POST(request) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, [
    "accounting.assets.register",
    "society.systemTests.update",
  ]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json();
    const asset = await registerAsset(auth.user.societyId, body, auth.user.userId);
    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    const mapped = mapError(error);
    if (mapped) return mapped;
    console.error("Register asset error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

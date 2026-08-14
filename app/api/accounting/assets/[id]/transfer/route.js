import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { transferAsset, AssetServiceError } from "@/lib/services/AssetService";

// POST /api/accounting/assets/[id]/transfer — custody/location change only, no ledger impact.
// Body: { toLocation?, toCustodian?, note? }
export async function POST(request, { params }) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { id } = await params;
    const body = await request.json();
    const asset = await transferAsset(
      auth.user.societyId,
      id,
      { toLocation: body.toLocation, toCustodian: body.toCustodian, note: body.note },
      auth.user.userId,
    );
    return NextResponse.json({ asset });
  } catch (error) {
    if (error instanceof AssetServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Transfer asset error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

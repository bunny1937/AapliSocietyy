import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { getAssetById, AssetServiceError } from "@/lib/services/AssetService";
import { authorizeAny } from "@/lib/rbac/authorize";

// GET /api/accounting/assets/[id]
export async function GET(request, { params }) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, [
    "accounting.assets.view",
    "society.systemTests.view",
  ]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await params;
    const asset = await getAssetById(auth.user.societyId, id);
    return NextResponse.json({ asset, currentValue: asset.currentValue() });
  } catch (error) {
    if (error instanceof AssetServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Get asset error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

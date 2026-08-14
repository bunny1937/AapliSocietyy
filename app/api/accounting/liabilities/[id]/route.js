import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { getLiabilityById, LiabilityServiceError } from "@/lib/services/LiabilityService";
import { authorize } from "@/lib/rbac/authorize";

// GET /api/accounting/liabilities/[id]
export async function GET(request, { params }) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await params;
    const liability = await getLiabilityById(auth.user.societyId, id);
    return NextResponse.json({ liability });
  } catch (error) {
    if (error instanceof LiabilityServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Get liability error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

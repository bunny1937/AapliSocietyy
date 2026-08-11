import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { getFundById, FundServiceError } from "@/lib/services/FundService";
import { authorize } from "@/lib/rbac/authorize";

// GET /api/accounting/funds/[id]
export async function GET(request, { params }) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await params;
    const fund = await getFundById(auth.user.societyId, id);
    return NextResponse.json({ fund });
  } catch (error) {
    if (error instanceof FundServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Get fund error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting, requireAccountingClose } from "@/lib/authz";
import { createFund, listFunds, FundServiceError } from "@/lib/services/FundService";
import { authorizeAny } from "@/lib/rbac/authorize";

// Never had a real permission — the Lab's systemTests grant was the only
// thing ever gating this. Paired with the real permission now that
// /admin/accounting/funds actually exists.
const VIEW = ["accounting.funds.view", "society.systemTests.view"];
const CREATE = ["accounting.funds.create", "society.systemTests.update"];

// GET /api/accounting/funds?fundType=ReserveFund
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, VIEW);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const funds = await listFunds(auth.user.societyId, {
      fundType: searchParams.get("fundType") || undefined,
    });
    return NextResponse.json({ funds });
  } catch (error) {
    console.error("List funds error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST /api/accounting/funds — register a fund against an existing Equity account. Admin/Secretary only.
export async function POST(request) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, CREATE);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json();
    const fund = await createFund(auth.user.societyId, body, auth.user.userId);
    return NextResponse.json({ fund }, { status: 201 });
  } catch (error) {
    if (error instanceof FundServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Create fund error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

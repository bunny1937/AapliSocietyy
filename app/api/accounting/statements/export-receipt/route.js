import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { authorizeAny } from "@/lib/rbac/authorize";
import {
  writeStatementExportReceipt,
  listStatementExportReceipts,
} from "@/lib/accounting/statementExportReceipts";

const EXPORT_PERM = ["statements.generateStatements.export", "society.systemTests.view"];

// POST /api/accounting/statements/export-receipt
// Stamps the statement currently on screen: computes its hash and records
// who exported it and when. Never blocks the print itself — a failure here
// still lets window.print() run; see the PageClient's own try/catch.
export async function POST(request) {
  try {
    const gate = await authorizeAny(request, EXPORT_PERM);
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    const decoded = token ? verifyToken(token) : null;
    if (!decoded) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { financialYearId, financialYearLabel, ie, bs, trialBalance } = await request.json();
    if (!financialYearId) {
      return NextResponse.json({ error: "financialYearId is required" }, { status: 400 });
    }
    const receipt = await writeStatementExportReceipt({
      societyId: decoded.societyId, financialYearId, financialYearLabel,
      actorId: decoded.userId, ie, bs, trialBalance,
    });
    return NextResponse.json({ receipt });
  } catch (error) {
    console.error("Statement export receipt error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET /api/accounting/statements/export-receipt?financialYearId=
export async function GET(request) {
  try {
    const gate = await authorizeAny(request, EXPORT_PERM);
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    const decoded = token ? verifyToken(token) : null;
    if (!decoded) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const financialYearId = searchParams.get("financialYearId");
    if (!financialYearId) return NextResponse.json({ receipts: [] });
    const receipts = await listStatementExportReceipts(decoded.societyId, financialYearId);
    return NextResponse.json({ receipts });
  } catch (error) {
    console.error("Statement export receipt list error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

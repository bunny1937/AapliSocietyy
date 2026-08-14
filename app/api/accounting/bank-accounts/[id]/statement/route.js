import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting, requireAccountingClose } from "@/lib/authz";
import {
  importBankStatement,
  listStatementLines,
  BankStatementServiceError,
} from "@/lib/services/BankStatementService";
import { BankAccountServiceError } from "@/lib/services/BankAccountService";

// GET /api/accounting/bank-accounts/[id]/statement?matchStatus=Unmatched&importBatchId=
export async function GET(request, { params }) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const lines = await listStatementLines(auth.user.societyId, id, {
      matchStatus: searchParams.get("matchStatus") || undefined,
      importBatchId: searchParams.get("importBatchId") || undefined,
    });
    return NextResponse.json({ lines });
  } catch (error) {
    console.error("List statement lines error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST /api/accounting/bank-accounts/[id]/statement — multipart form, field "file". Admin/Secretary only.
export async function POST(request, { params }) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { id } = await params;
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "A file is required" }, { status: 400 });
    }
    const bytes = await file.arrayBuffer();
    const result = await importBankStatement(auth.user.societyId, id, Buffer.from(bytes), auth.user.userId);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof BankStatementServiceError || error instanceof BankAccountServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Import bank statement error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

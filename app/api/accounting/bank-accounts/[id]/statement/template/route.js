import { NextResponse } from "next/server";
import { requireAccounting } from "@/lib/authz";
import { generateBankStatementTemplate } from "@/lib/accounting/bankStatementExcel";
import { authorizeAny } from "@/lib/rbac/authorize";

const VIEW = ["accounting.bankAccounts.view", "society.systemTests.view"];

// GET /api/accounting/bank-accounts/[id]/statement/template — downloads the import template.
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, VIEW);
  if (!gate.ok) return gate.response;
  try {
    const buffer = await generateBankStatementTemplate();
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="bank-statement-template.xlsx"',
      },
    });
  } catch (error) {
    console.error("Generate bank statement template error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

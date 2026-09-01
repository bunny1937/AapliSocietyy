import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting, requireAccountingClose } from "@/lib/authz";
import { authorizeAny } from "@/lib/rbac/authorize";
import {
  getFiscalConfig,
  updateFiscalConfig,
  FiscalConfigServiceError,
} from "@/lib/services/FiscalConfigService";

const VIEW = ["accounting.fiscalConfig.view", "society.systemTests.view"];
const UPDATE = ["accounting.fiscalConfig.update", "society.systemTests.update"];

// GET /api/accounting/fiscal-config — the ERP's accounting control center (§6.11).
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, VIEW);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const accountingConfig = await getFiscalConfig(auth.user.societyId);
    return NextResponse.json({ accountingConfig });
  } catch (error) {
    if (error instanceof FiscalConfigServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Get fiscal config error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// PATCH /api/accounting/fiscal-config — Admin/Secretary only.
export async function PATCH(request) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, UPDATE);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const patch = await request.json();
    const accountingConfig = await updateFiscalConfig(auth.user.societyId, patch);
    return NextResponse.json({ accountingConfig });
  } catch (error) {
    if (error instanceof FiscalConfigServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Update fiscal config error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

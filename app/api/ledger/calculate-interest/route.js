import { NextResponse } from "next/server";
import { authorize } from "@/lib/rbac/authorize";
export async function POST(request) {
  const gate = await authorize(request, "finance.ledger.calculateInterest");
  if (!gate.ok) return gate.response;
  // ❌ DISABLED — system uses monthly bill-time interest only.
  // Daily interest accrual removed per new billing model.
  return NextResponse.json(
    {
      success: false,
      message:
        "Daily interest cron disabled. Interest is calculated monthly at bill generation.",
    },
    { status: 410 },
  );
}

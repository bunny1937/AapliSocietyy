import { NextResponse } from "next/server";
import { authorize } from "@/lib/rbac/authorize";

// Member self-pay disabled — all payments are reconciled via admin Excel
// upload. (Previously this handler had a full allocation implementation
// below an unconditional early return, making it permanently unreachable
// dead code — removed rather than converted, since it never ran.)
export async function POST(request) {
  const gate = await authorize(request, "finance.payment.record");
  if (!gate.ok) return gate.response;
  return NextResponse.json(
    { error: "Online payment is not available. Please contact your society admin." },
    { status: 403 },
  );
}

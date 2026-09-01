import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { authorize } from "@/lib/rbac/authorize";
import { getLatestBillGenerationReceipt, listBillGenerationReceipts } from "@/lib/billing/billGenerationReceipts";

// GET /api/bills/generate-final/receipt?billPeriodId=&billSeries=
// GET /api/bills/generate-final/receipt?recent=1
// ----------------------------------------------------------------------------
// Read-only. Additive to the bill-generation flow (design doc §12 Phase 6) —
// BillGenerationFlow.jsx is untouched; this is a new, separate endpoint a
// UI can call later to show "last run: 12 Apr 2026 by Suresh Patil".
export async function GET(request) {
  const gate = await authorize(request, "billing.bill.generate");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    const decoded = token ? verifyToken(token) : null;
    if (!decoded) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    if (searchParams.get("recent") === "1") {
      const receipts = await listBillGenerationReceipts(decoded.societyId, { limit: 20 });
      return NextResponse.json({ receipts });
    }

    const billPeriodId = searchParams.get("billPeriodId");
    const billSeries = searchParams.get("billSeries") || "RESIDENTIAL";
    if (!billPeriodId) {
      return NextResponse.json({ error: "billPeriodId is required (or pass recent=1)" }, { status: 400 });
    }
    const receipt = await getLatestBillGenerationReceipt(decoded.societyId, billPeriodId, billSeries);
    return NextResponse.json({ receipt });
  } catch (error) {
    console.error("[billing] generation receipt GET failed:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

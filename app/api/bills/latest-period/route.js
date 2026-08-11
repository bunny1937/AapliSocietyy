import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { authorize } from "@/lib/rbac/authorize";
export async function GET(request) {
  try {
    const gate = await authorize(request, "billing.bill.view");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const billSeries = searchParams.get("billSeries") === "COMMERCIAL" ? "COMMERCIAL" : "RESIDENTIAL";
    const now = new Date();
    const currentPeriodId = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    // Latest generated period for this society, THIS series only.
    const latestBill = await Bill.findOne({
      societyId: decoded.societyId,
      billSeries,
      isDeleted: { $ne: true },
    })
      .sort({ billPeriodId: -1 })
      .select("billPeriodId")
      .lean();
    const latestPeriodId = latestBill?.billPeriodId || null;
    // Is current month generated? Also true if a future month is already generated.
    const currentGenerated =
      !!latestPeriodId && String(latestPeriodId) >= String(currentPeriodId);
    // Next period = one month after latest (or current if nothing generated)
    let nextPeriodId = null;
    if (latestPeriodId) {
      const [y, m] = latestPeriodId.split("-").map(Number);
      const nextDate = new Date(y, m, 1); // month m is already 1-indexed, so new Date(y, m, 1) = next month
      nextPeriodId = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`;
    }
    // Are all bills for latest period fully paid?
    let allPaid = false;
    if (latestPeriodId) {
      const unpaidBill = await Bill.findOne({
        societyId: decoded.societyId,
        billPeriodId: latestPeriodId,
        billSeries,
        isDeleted: { $ne: true },
        balanceAmount: { $gt: 0.005 },
      })
        .select("_id")
        .lean();
      allPaid = !unpaidBill;
    }
    return NextResponse.json({
      latestPeriodId,
      currentPeriodId,
      currentGenerated,
      allPaid,
      nextPeriodId,
      billSeries,
    });
  } catch (err) {
    console.error("latest-period error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

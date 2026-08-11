import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { authorize } from "@/lib/rbac/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lists every bill currently in the "PaymentDone" state (cash/manual payment
// acknowledged, awaiting the confirming Excel upload) for the admin payments
// page, with the member + pending-payment details.
export async function GET(request) {
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const gate = await authorize(request, "finance.payments.view");
    if (!gate.ok) return gate.response;

    const bills = await Bill.find({
      societyId: decoded.societyId,
      status: "PaymentDone",
      isHistoricalArchive: { $ne: true },
      isDeleted: { $ne: true },
    })
      .sort({ "pendingPayment.recordedAt": -1 })
      .select("_id billPeriodId memberId totalBillDue balanceAmount pendingPayment")
      .lean();

    const memberIds = [...new Set(bills.map((b) => String(b.memberId)))];
    const members = await Member.find({ _id: { $in: memberIds } })
      .select("_id ownerName wing flatNo")
      .lean();
    const mMap = new Map(members.map((m) => [String(m._id), m]));

    const out = bills.map((b) => {
      const m = mMap.get(String(b.memberId));
      const pp = b.pendingPayment || {};
      return {
        billId: String(b._id),
        billPeriodId: b.billPeriodId,
        memberId: String(b.memberId),
        memberName: m?.ownerName || "—",
        flat: m ? `${m.wing || ""}-${m.flatNo || ""}` : "—",
        totalBillDue: b.totalBillDue,
        balanceAmount: b.balanceAmount,
        amount: pp.amount ?? null,
        paymentMode: pp.paymentMode ?? null,
        paymentDate: pp.paymentDate ?? null,
        notes: pp.notes ?? null,
        recordedAt: pp.recordedAt ?? null,
      };
    });

    return NextResponse.json({ bills: out, count: out.length }, { status: 200 });
  } catch (err) {
    console.error("[pending-done] error:", err?.message ?? err);
    return NextResponse.json({ error: "Failed to load pending payments" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import AuditLog from "@/models/AuditLog";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { authorize } from "@/lib/rbac/authorize";
import cache from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Records a cash / manual "Payment Done" acknowledgement. It flags the
// member's latest live bill as status "PaymentDone" and stores the pending
// payment details, but does NOT allocate anything to the ledger. The bill is
// only finalized to "Paid" when the confirming payment Excel is uploaded via
// /api/billing/upload-payments.
export async function POST(request) {
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const gate = await authorize(request, "finance.payment.record");
    if (!gate.ok) return gate.response;

    const { memberId, amount, paymentMode, paymentDate, notes } = await request.json();
    if (!memberId || !amount) {
      return NextResponse.json({ error: "Member ID and amount are required" }, { status: 400 });
    }
    if (Number(amount) <= 0) {
      return NextResponse.json({ error: "Amount must be greater than zero" }, { status: 400 });
    }

    const member = await Member.findOne({ _id: memberId, societyId: decoded.societyId }).select("_id ownerName wing flatNo");
    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });

    // LOOP-04: "PaymentDone" is deliberately excluded here — a bill already
    // carrying an unreconciled pendingPayment must not be re-selected and
    // silently overwritten by a retried or duplicate request.
    const bill = await Bill.findOne({
      memberId,
      societyId: decoded.societyId,
      status: { $in: ["Unpaid", "Partial", "Overdue"] },
      isHistoricalArchive: { $ne: true },
      isDeleted: { $ne: true },
    })
      .sort({ billYear: -1, billMonth: -1, updatedAt: -1 })
      .select("_id billPeriodId status");
    if (!bill) {
      return NextResponse.json({ error: "No outstanding bill found for this member" }, { status: 400 });
    }

    const pendingPayment = {
      amount: parseFloat(amount),
      paymentMode: paymentMode || "Cash",
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      notes: notes || null,
      recordedBy: decoded.userId,
      recordedAt: new Date(),
    };

    // Compare-and-set: only transitions a bill that is still in the status we
    // just read it in. A concurrent/duplicate call loses this race and 409s.
    const result = await Bill.updateOne(
      { _id: bill._id, status: bill.status },
      { $set: { status: "PaymentDone", pendingPayment } },
    );
    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "Payment already recorded for this bill" }, { status: 409 });
    }

    await AuditLog.create({
      userId: decoded.userId,
      societyId: decoded.societyId,
      action: "MARK_PAYMENT_DONE",
      newData: {
        memberId,
        memberName: member.ownerName,
        billId: bill._id,
        billPeriodId: bill.billPeriodId,
        ...pendingPayment,
      },
      timestamp: new Date(),
    });

    await cache.del(`v1:bills:${decoded.societyId}:member:${memberId}`);

    return NextResponse.json(
      {
        success: true,
        message: "Marked as Payment Done. Upload the payment Excel to finalize as Paid.",
        billId: bill._id,
        billPeriodId: bill.billPeriodId,
        status: "PaymentDone",
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[mark-done] error:", err?.message ?? err);
    return NextResponse.json({ error: "Failed to mark payment done" }, { status: 500 });
  }
}

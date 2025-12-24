import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
// import Bill from "@/models/Bill"; // ❌ NOT USED ANYMORE
import Transaction from "@/models/Transaction";
import Member from "@/models/Member";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { getFinancialYear } from "@/lib/date-utils";
import AuditLog from "@/models/AuditLog";

export async function POST(request) {
  try {
    await connectDB();

    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const {
      memberId,
      amount,
      paymentMode,
      paymentDate,
      paymentDetails,
      notes,
    } = await request.json();

    if (!memberId || !amount) {
      return NextResponse.json(
        {
          error: "Member ID and amount are required",
        },
        { status: 400 }
      );
    }

    if (amount <= 0) {
      return NextResponse.json(
        {
          error: "Payment amount must be greater than zero",
        },
        { status: 400 }
      );
    }

    const member = await Member.findOne({
      _id: memberId,
      societyId: decoded.societyId,
    });

    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    // 🔁 NEW LOGIC: outstanding = latest ledger balance (no Bill model)
    const lastTransaction = await Transaction.findOne({
      memberId,
      societyId: decoded.societyId,
      isReversed: false,
    })
      .sort({ date: -1, createdAt: -1 })
      .lean();

    const currentBalance =
      lastTransaction?.balanceAfterTransaction ?? member.openingBalance ?? 0;

    if (currentBalance <= 0) {
      return NextResponse.json(
        {
          error: "No outstanding bills found for this member",
        },
        { status: 400 }
      );
    }

    // Do not allow over‑payment
    if (amount > currentBalance) {
      return NextResponse.json(
        {
          error: `Payment amount exceeds outstanding balance. Outstanding: ${currentBalance}`,
        },
        { status: 400 }
      );
    }

    // We no longer adjust individual Bill documents, so:
    const remainingAmount = 0; // no advance handling based on per-bill logic
    const totalAdjusted = parseFloat(amount);
    const updatedBills = []; // kept for response shape / AuditLog

    const previousBalance = currentBalance;
    const newBalance = previousBalance - totalAdjusted;

    const transaction = await Transaction.create({
      transactionId: Transaction.generateTransactionId(),
      date: paymentDate ? new Date(paymentDate) : new Date(),
      memberId,
      societyId: decoded.societyId,
      type: "Credit",
      category: "Payment",
      description: `Payment received via ${paymentMode || "Cash"}${
        notes ? ` - ${notes}` : ""
      }`,
      amount: totalAdjusted,
      balanceAfterTransaction: newBalance,
      paymentMode: paymentMode || "Cash",
      paymentDetails: paymentDetails || {},
      createdBy: decoded.userId,
      financialYear: getFinancialYear(new Date()),
    });

    // Advance payment logic **optional** now. If you still want to allow
    // paying more than currentBalance, you can restore your old remainingAmount
    // logic and create an Adjustment transaction. For now we keep it 0.

    await AuditLog.create({
      userId: decoded.userId,
      societyId: decoded.societyId,
      action: "RECORD_PAYMENT",
      newData: {
        memberId,
        memberName: member.ownerName,
        roomNo: member.roomNo,
        amount: totalAdjusted,
        paymentMode,
        billsAdjusted: updatedBills.length,
      },
      timestamp: new Date(),
    });

    return NextResponse.json(
      {
        success: true,
        message: "Payment recorded successfully",
        transaction: {
          transactionId: transaction.transactionId,
          amount: totalAdjusted,
          advanceAmount: remainingAmount > 0 ? remainingAmount : 0,
          billsAdjusted: updatedBills.length,
          updatedBills,
          newBalance,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Record payment error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error.message,
      },
      { status: 500 }
    );
  }
}

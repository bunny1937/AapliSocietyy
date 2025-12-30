import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import Bill from "@/models/Bill"; // ✅ ADDED
import Member from "@/models/Member";
import Society from "@/models/Society";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { getFinancialYear } from "@/lib/date-utils";
import AuditLog from "@/models/AuditLog";
import { calculateBillStatusAfterPayment } from '@/lib/bill-status-manager';

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
      chequeNo,
      bankName,
      upiId,
      transactionRef,
      notes,
    } = await request.json();

    if (!memberId || !amount) {
      return NextResponse.json(
        { error: "Member ID and amount are required" },
        { status: 400 }
      );
    }

    if (amount <= 0) {
      return NextResponse.json(
        { error: "Payment amount must be greater than zero" },
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

    // ✅ CORRECT: Get outstanding bills (not transactions)
    const unpaidBills = await Bill.find({
      memberId,
      societyId: decoded.societyId,
      status: { $in: ["Unpaid", "Partial", "Overdue"] },
      isDeleted: false,
    }).sort({ billYear: 1, billMonth: 1 }); // Oldest first

    if (unpaidBills.length === 0) {
      return NextResponse.json(
        { error: "No outstanding bills found for this member" },
        { status: 400 }
      );
    }

    // ✅ Calculate total outstanding from BILLS
    const totalOutstanding = unpaidBills.reduce(
      (sum, bill) => sum + bill.balanceAmount,
      0
    );

    if (amount > totalOutstanding) {
      return NextResponse.json(
        {
          error: `Payment amount exceeds outstanding balance. Outstanding: ₹${totalOutstanding.toFixed(2)}`,
        },
        { status: 400 }
      );
    }

    // ✅ Get current ledger balance for transaction
    const lastTransaction = await Transaction.findOne({
      memberId,
      societyId: decoded.societyId,
      isReversed: false,
    })
      .sort({ date: -1, createdAt: -1 })
      .lean();

    let currentLedgerBalance =
      lastTransaction?.balanceAfterTransaction ?? member.openingBalance ?? 0;

    // ✅ ALLOCATE PAYMENT TO BILLS (FIFO - First In First Out)
    let remainingPayment = parseFloat(amount);
    const billsUpdated = [];

    for (const bill of unpaidBills) {
      if (remainingPayment <= 0) break;

      const billBalance = bill.balanceAmount;
      const paymentForThisBill = Math.min(remainingPayment, billBalance);

      // Update bill
      bill.amountPaid += paymentForThisBill;
      bill.balanceAmount -= paymentForThisBill;

      // ✅ EXPLICIT STATUS (using helper function)
      bill.status = calculateBillStatusAfterPayment(
        bill.totalAmount,
        bill.amountPaid
      );

      bill.lastModifiedAt = new Date();
      bill.lastModifiedBy = decoded.userId;

      await bill.save();

      billsUpdated.push({
        billId: bill._id,
        billPeriod: bill.billPeriodId,
        amountPaid: paymentForThisBill,
        newStatus: bill.status,
      });

      remainingPayment -= paymentForThisBill;
    }

    // ✅ RECORD PAYMENT TRANSACTION IN LEDGER
    const paymentAmount = parseFloat(amount);
    const newLedgerBalance = currentLedgerBalance - paymentAmount;

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
      amount: paymentAmount,
      balanceAfterTransaction: newLedgerBalance,
      paymentMode: paymentMode || "Cash",
      chequeNo,
      bankName,
      upiId,
      transactionRef,
      notes,
      createdBy: decoded.userId,
      financialYear: getFinancialYear(new Date()),
    });

    // ✅ AUDIT LOG
    await AuditLog.create({
      userId: decoded.userId,
      societyId: decoded.societyId,
      action: "RECORD_PAYMENT",
      newData: {
        memberId,
        memberName: member.ownerName,
        roomNo: member.roomNo,
        wing: member.wing,
        amount: paymentAmount,
        paymentMode,
        previousBalance: currentLedgerBalance,
        newBalance: newLedgerBalance,
        billsUpdated,
      },
      timestamp: new Date(),
    });

    return NextResponse.json(
      {
        success: true,
        message: "Payment recorded successfully",
        transaction: {
          transactionId: transaction.transactionId,
          amount: paymentAmount,
          previousBalance: currentLedgerBalance,
          newBalance: newLedgerBalance,
          billsUpdated,
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

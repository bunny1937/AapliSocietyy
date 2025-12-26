import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import Member from "@/models/Member";
import Society from "@/models/Society"; // ✅ ADDED (was missing)
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

    // ✅ Get current balance from latest transaction
    const lastTransaction = await Transaction.findOne({
      memberId,
      societyId: decoded.societyId,
      isReversed: false,
    })
      .sort({ date: -1, createdAt: -1 })
      .lean();

    let currentBalance =
      lastTransaction?.balanceAfterTransaction ?? member.openingBalance ?? 0;

    if (currentBalance <= 0) {
      return NextResponse.json(
        { error: "No outstanding bills found for this member" },
        { status: 400 }
      );
    }

    // ✅ FETCH SOCIETY CONFIG FOR INTEREST CALCULATION
    const society = await Society.findById(decoded.societyId).lean();
    const {
      interestRate = 0,
      gracePeriodDays = 10,
      billDueDay = 10,
      interestCalculationMethod = "COMPOUND",
      interestCompoundingFrequency = "MONTHLY",
    } = society.config || {};

    let interestAmount = 0;
    let daysOverdue = 0;

    // ✅ Find oldest unpaid bill to calculate interest
    const oldestUnpaidBill = await Transaction.findOne({
      memberId,
      societyId: decoded.societyId,
      type: "Debit",
      category: "Maintenance",
      isReversed: false,
    })
      .sort({ date: 1 }) // Oldest first
      .lean();

    if (oldestUnpaidBill && interestRate > 0) {
      const billDate = new Date(oldestUnpaidBill.date);
      const dueDate = new Date(
        billDate.getFullYear(),
        billDate.getMonth(),
        billDueDay
      );
      const graceEndDate = new Date(dueDate);
      graceEndDate.setDate(graceEndDate.getDate() + gracePeriodDays);

      const now = new Date();
      if (now > graceEndDate) {
        daysOverdue = Math.floor((now - graceEndDate) / (1000 * 60 * 60 * 24));

        // Calculate interest
        if (interestCalculationMethod === "SIMPLE") {
          const monthsOverdue = daysOverdue / 30;
          interestAmount =
            currentBalance * (interestRate / 100) * monthsOverdue;
        } else {
          // COMPOUND
          const n = interestCompoundingFrequency === "DAILY" ? 30 : 1;
          const t = daysOverdue / 30;
          if (t > 0) {
            const r = interestRate / 100;
            const amount = currentBalance * Math.pow(1 + r / n, n * t);
            interestAmount = amount - currentBalance;
          }
        }

        interestAmount = Math.round(interestAmount * 100) / 100;
      }
    }

    // ✅ ADD INTEREST TRANSACTION IF OVERDUE
    if (interestAmount > 0) {
      await Transaction.create({
        transactionId: Transaction.generateTransactionId(),
        date: new Date(),
        memberId,
        societyId: decoded.societyId,
        type: "Debit",
        category: "Interest",
        description: `Interest on arrears (${daysOverdue} days overdue, ${interestCalculationMethod.toLowerCase()} @ ${interestRate}%)`,
        amount: interestAmount,
        balanceAfterTransaction: currentBalance + interestAmount,
        paymentMode: "System",
        createdBy: decoded.userId,
        financialYear: getFinancialYear(new Date()),
      });

      console.log(
        `✅ Added interest: ₹${interestAmount} for member ${member.ownerName} (${daysOverdue} days overdue)`
      );

      // ✅ UPDATE CURRENT BALANCE AFTER ADDING INTEREST
      currentBalance = currentBalance + interestAmount;
    }

    // ✅ VALIDATE PAYMENT AMOUNT
    if (amount > currentBalance) {
      return NextResponse.json(
        {
          error: `Payment amount exceeds outstanding balance. Outstanding: ₹${currentBalance.toFixed(
            2
          )}`,
        },
        { status: 400 }
      );
    }

    // ✅ RECORD PAYMENT TRANSACTION
    const totalAdjusted = parseFloat(amount);
    const newBalance = currentBalance - totalAdjusted;

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
        amount: totalAdjusted,
        paymentMode,
        interestAdded: interestAmount,
        previousBalance: currentBalance,
        newBalance,
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
          interestAdded: interestAmount, // ✅ Show interest added
          previousBalance: currentBalance, // ✅ Before payment
          newBalance, // ✅ After payment
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

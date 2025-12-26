import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import Transaction from "@/models/Transaction";
import Member from "@/models/Member";
import Society from "@/models/Society";

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

    const society = await Society.findById(decoded.societyId);
    if (!society) {
      return NextResponse.json({ error: "Society not found" }, { status: 404 });
    }

    const {
      interestRate,
      gracePeriodDays,
      billDueDay,
      interestCalculationMethod,
      interestCompoundingFrequency,
    } = society.config;

    // Get all members with outstanding balances
    const members = await Member.find({ societyId: decoded.societyId });
    const interestTransactions = [];

    for (const member of members) {
      // Get latest transaction for balance
      const lastTxn = await Transaction.findOne({
        memberId: member._id,
        societyId: decoded.societyId,
        isReversed: false,
      })
        .sort({ date: -1, createdAt: -1 })
        .lean();

      if (!lastTxn || lastTxn.balanceAfterTransaction <= 0) continue; // No outstanding balance

      // Find oldest unpaid bill (debit transaction)
      const oldestUnpaidBill = await Transaction.findOne({
        memberId: member._id,
        societyId: decoded.societyId,
        type: "Debit",
        category: "Maintenance",
        isReversed: false,
      })
        .sort({ date: 1 }) // Oldest first
        .lean();

      if (!oldestUnpaidBill) continue;

      const dueDate = new Date(oldestUnpaidBill.date);
      dueDate.setDate(billDueDay); // Set to configured due day

      const graceEndDate = new Date(dueDate);
      graceEndDate.setDate(graceEndDate.getDate() + gracePeriodDays);

      const now = new Date();
      if (now <= graceEndDate) continue; // Still within grace period

      const daysOverdue = Math.floor(
        (now - graceEndDate) / (1000 * 60 * 60 * 24)
      );
      const outstandingBalance = lastTxn.balanceAfterTransaction;

      let interest = 0;

      if (interestCalculationMethod === "SIMPLE") {
        const monthsOverdue = daysOverdue / 30;
        interest = outstandingBalance * (interestRate / 100) * monthsOverdue;
      } else {
        // COMPOUND
        let n = interestCompoundingFrequency === "DAILY" ? 30 : 1;
        let t = daysOverdue / 30;

        if (t > 0) {
          const r = interestRate / 100;
          const amount = outstandingBalance * Math.pow(1 + r / n, n * t);
          interest = amount - outstandingBalance;
        }
      }

      interest = Math.round(interest * 100) / 100;

      if (interest > 0) {
        // Check if interest already added today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const existingInterestToday = await Transaction.findOne({
          memberId: member._id,
          societyId: decoded.societyId,
          category: "Interest",
          date: { $gte: today },
        });

        if (!existingInterestToday) {
          const newBalance = lastTxn.balanceAfterTransaction + interest;

          const txn = await Transaction.create({
            transactionId: Transaction.generateTransactionId(),
            date: new Date(),
            memberId: member._id,
            societyId: decoded.societyId,
            type: "Debit",
            category: "Interest",
            description: `Interest on arrears (${daysOverdue} days overdue, ${interestCalculationMethod.toLowerCase()} @ ${interestRate}%)`,
            amount: interest,
            balanceAfterTransaction: newBalance,
            paymentMode: "System",
            createdBy: decoded.userId,
            financialYear: `${new Date().getFullYear()}-${
              new Date().getFullYear() + 1
            }`,
          });

          interestTransactions.push({
            memberId: member._id,
            memberName: member.ownerName,
            roomNo: `${member.wing}-${member.roomNo}`,
            interestAmount: interest,
            daysOverdue,
            newBalance,
            transactionId: txn.transactionId,
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Applied interest to ${interestTransactions.length} members`,
      interestTransactions,
    });
  } catch (error) {
    console.error("Interest calculation error:", error);
    return NextResponse.json(
      { error: "Failed to calculate interest", details: error.message },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import Society from "@/models/Society";
import Member from "@/models/Member";
import { getFinancialYear } from "@/lib/date-utils";

export async function POST(request) {
  try {
    await connectDB();

    // ✅ Optional: Add admin token validation
    // For now, allowing direct calls from cron

    const societies = await Society.find({ isDeleted: false }).lean();
    let totalInterestAdded = 0;
    let totalMembersAffected = 0;

    for (const society of societies) {
      const { config } = society;
      const {
        interestRate = 0,
        gracePeriodDays = 10,
        billDueDay = 10,
        interestCalculationMethod = "COMPOUND",
        interestCompoundingFrequency = "MONTHLY",
      } = config || {};

      if (interestRate === 0) {
        console.log(`⏭️  Skipping ${society.name} - No interest rate configured`);
        continue;
      }

      // ✅ Find all overdue bills for this society
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const overdueBills = await Bill.find({
        societyId: society._id,
        status: { $in: ["Unpaid", "Partial", "Overdue"] },
        dueDate: { $lt: today },
        balanceAmount: { $gt: 0 },
        isDeleted: false,
      }).lean();

      if (overdueBills.length === 0) {
        console.log(`✅ ${society.name} - No overdue bills`);
        continue;
      }

      // ✅ Group by member
      const billsByMember = {};
      overdueBills.forEach(bill => {
        const memberId = bill.memberId.toString();
        if (!billsByMember[memberId]) {
          billsByMember[memberId] = [];
        }
        billsByMember[memberId].push(bill);
      });

      // ✅ Calculate interest per member
      for (const [memberId, memberBills] of Object.entries(billsByMember)) {
        // Find oldest overdue bill
        const oldestBill = memberBills.sort((a, b) => 
          new Date(a.dueDate) - new Date(b.dueDate)
        )[0];

        const dueDate = new Date(oldestBill.dueDate);
        const graceEndDate = new Date(dueDate);
        graceEndDate.setDate(graceEndDate.getDate() + gracePeriodDays);

        if (today <= graceEndDate) {
          continue; // Still in grace period
        }

        const daysOverdue = Math.floor((today - graceEndDate) / (1000 * 60 * 60 * 24));

        // Calculate total outstanding for this member
        const totalOutstanding = memberBills.reduce((sum, bill) => sum + bill.balanceAmount, 0);

        let interestAmount = 0;

        // Calculate interest
        if (interestCalculationMethod === "SIMPLE") {
          const monthsOverdue = daysOverdue / 30;
          interestAmount = totalOutstanding * (interestRate / 100) * monthsOverdue;
        } else {
          // COMPOUND
          const n = interestCompoundingFrequency === "DAILY" ? 30 : 1;
          const t = daysOverdue / 30;
          if (t > 0) {
            const r = interestRate / 100;
            const amount = totalOutstanding * Math.pow(1 + r / n, n * t);
            interestAmount = amount - totalOutstanding;
          }
        }

        interestAmount = Math.round(interestAmount * 100) / 100;

        if (interestAmount <= 0) continue;

        // ✅ Check if interest already added today
        const existingInterestToday = await Transaction.findOne({
          memberId,
          societyId: society._id,
          category: "Interest",
          date: {
            $gte: today,
            $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
          }
        });

        if (existingInterestToday) {
          console.log(`⏭️  Interest already added today for member ${memberId}`);
          continue;
        }

        // ✅ Get current ledger balance
        const lastTransaction = await Transaction.findOne({
          memberId,
          societyId: society._id,
          isReversed: false,
        })
          .sort({ date: -1, createdAt: -1 })
          .lean();

        const member = await Member.findById(memberId).lean();
        let currentBalance =
          lastTransaction?.balanceAfterTransaction ?? member?.openingBalance ?? 0;

        // ✅ Add interest transaction
        await Transaction.create({
          transactionId: Transaction.generateTransactionId(),
          date: today,
          memberId,
          societyId: society._id,
          type: "Debit",
          category: "Interest",
          description: `Interest on arrears (${daysOverdue} days overdue, ${interestCalculationMethod} @ ${interestRate}%)`,
          amount: interestAmount,
          balanceAfterTransaction: currentBalance + interestAmount,
          paymentMode: "System",
          createdBy: null, // System generated
          financialYear: getFinancialYear(today),
        });

        totalInterestAdded += interestAmount;
        totalMembersAffected++;

        console.log(`✅ Added ₹${interestAmount} interest for member ${memberId} (${daysOverdue} days overdue)`);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Interest calculation completed`,
      totalInterestAdded,
      totalMembersAffected,
      societiesProcessed: societies.length,
    });

  } catch (error) {
    console.error("Interest calculation error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error.message,
      },
      { status: 500 }
    );
  }
}

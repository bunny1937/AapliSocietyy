import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import Member from "@/models/Member";
import BillingHead from "@/models/BillingHead";
import Transaction from "@/models/Transaction";

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

    if (decoded.role === "Accountant") {
      return NextResponse.json(
        {
          error: "Insufficient permissions",
        },
        { status: 403 }
      );
    }

    const { year, month } = await request.json();

    if (!year || !month) {
      return NextResponse.json(
        {
          error: "Year and month are required",
        },
        { status: 400 }
      );
    }

    // Get all active members
    const members = await Member.find({
      societyId: decoded.societyId,
    });

    if (members.length === 0) {
      return NextResponse.json(
        {
          error: "No members found",
        },
        { status: 400 }
      );
    }

    // Get all active billing heads
    const billingHeads = await BillingHead.find({
      societyId: decoded.societyId,
      isActive: true,
    }).sort({ order: 1 });

    if (billingHeads.length === 0) {
      return NextResponse.json(
        {
          error:
            "No billing heads configured. Please setup billing heads first.",
        },
        { status: 400 }
      );
    }

    // Check if bills already exist for this month
    const billPeriod = `${year}-${String(month).padStart(2, "0")}`;
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const existingBills = await Transaction.countDocuments({
      societyId: decoded.societyId,
      billPeriodId: billPeriod,
      category: "Maintenance",
    });

    if (existingBills > 0) {
      return NextResponse.json(
        {
          error: `Bills already exist for ${billPeriod}. Delete existing bills first.`,
        },
        { status: 400 }
      );
    }

    // Calculate financial year
    const financialYear =
      month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`;

    const createdBills = [];
    const errors = [];

    for (const member of members) {
      try {
        // Calculate total bill amount based on billing heads
        let totalAmount = 0;
        const breakdownItems = [];

        for (const head of billingHeads) {
          let amount = 0;

          switch (head.calculationType) {
            case "Fixed":
              amount = head.defaultAmount || 0;
              break;

            case "Per Sq Ft":
              amount = (head.defaultAmount || 0) * (member.areaSqFt || 0);
              break;

            case "Percentage":
              amount = (totalAmount * (head.defaultAmount || 0)) / 100;
              break;

            default:
              amount = head.defaultAmount || 0;
          }

          if (amount > 0) {
            breakdownItems.push({
              head: head.headName,
              amount: Math.round(amount),
            });
            totalAmount += amount;
          }
        }

        totalAmount = Math.round(totalAmount);

        // Get previous balance for this member
        const previousTransactions = await Transaction.find({
          societyId: decoded.societyId,
          memberId: member._id,
          date: { $lt: startDate },
        })
          .sort({ date: -1, createdAt: -1 })
          .limit(1);

        let previousBalance = member.openingBalance || 0;

        if (previousTransactions.length > 0) {
          previousBalance = previousTransactions[0].balanceAfterTransaction;
        }

        // New balance after adding this bill (debit increases balance)
        const newBalance = previousBalance + totalAmount;

        // Generate transaction ID using model static method
        const transactionId = Transaction.generateTransactionId();

        // Create transaction for the bill
        const transaction = await Transaction.create({
          transactionId,
          societyId: decoded.societyId,
          memberId: member._id,
          date: new Date(year, month - 1, 1),
          type: "Debit", // ← Bills are debits (member owes money)
          category: "Maintenance", // ← Using allowed enum value
          description: `Bill for ${billPeriod} - ${breakdownItems
            .map((b) => b.head)
            .join(", ")}`,
          amount: totalAmount,
          balanceAfterTransaction: newBalance,
          paymentMode: "System",
          createdBy: decoded.userId,
          billPeriodId: billPeriod,
          financialYear,
        });

        createdBills.push({
          memberId: member._id,
          memberName: member.ownerName,
          roomNo: member.roomNo,
          wing: member.wing,
          amount: totalAmount,
          previousBalance,
          newBalance,
          transactionId: transaction.transactionId,
          breakdown: breakdownItems,
        });
      } catch (err) {
        console.error(`Error creating bill for member ${member.roomNo}:`, err);
        errors.push({
          memberId: member._id,
          roomNo: member.roomNo,
          error: err.message,
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Generated ${createdBills.length} bills for ${billPeriod}`,
      createdBills,
      errors: errors.length > 0 ? errors : undefined,
      summary: {
        totalMembers: members.length,
        billsGenerated: createdBills.length,
        billsFailed: errors.length,
        totalAmount: createdBills.reduce((sum, bill) => sum + bill.amount, 0),
        billPeriod,
        financialYear,
      },
    });
  } catch (error) {
    console.error("Bill generation error:", error);
    return NextResponse.json(
      {
        error: "Bill generation failed",
        details: error.message,
      },
      { status: 500 }
    );
  }
}

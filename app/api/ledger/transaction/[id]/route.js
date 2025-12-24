import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import Transaction from "@/models/Transaction";
import BillingHead from "@/models/BillingHead";

export async function GET(request, { params }) {
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

    const { id } = params;

    const transaction = await Transaction.findOne({
      _id: id,
      societyId: decoded.societyId,
    })
      .populate(
        "memberId",
        "roomNo wing ownerName email mobile areaSqFt config"
      )
      .populate("createdBy", "name email role")
      .lean();

    if (!transaction) {
      return NextResponse.json(
        { error: "Transaction not found" },
        { status: 404 }
      );
    }

    // If this is a bill, fetch breakdown
    let breakdown = null;
    if (transaction.category === "Maintenance" && transaction.billPeriodId) {
      const billingHeads = await BillingHead.find({
        societyId: decoded.societyId,
        isActive: true,
      })
        .sort({ order: 1 })
        .lean();

      breakdown = billingHeads.map((head) => {
        let amount = 0;
        if (head.calculationType === "Fixed") {
          amount = head.defaultAmount;
        } else if (head.calculationType === "Per Sq Ft") {
          amount = head.defaultAmount * (transaction.memberId?.areaSqFt || 0);
        }
        return {
          headName: head.headName,
          calculationType: head.calculationType,
          amount: Math.round(amount),
        };
      });
    }

    // Audit trail (for now just created info; extend with edit/reversal logs later)
    const auditTrail = [
      {
        action: "Created",
        user: transaction.createdBy,
        timestamp: transaction.createdAt,
      },
    ];

    if (transaction.isReversed && transaction.reversalTransactionId) {
      const reversalTxn = await Transaction.findOne({
        transactionId: transaction.reversalTransactionId,
      })
        .populate("createdBy", "name")
        .lean();

      if (reversalTxn) {
        auditTrail.push({
          action: "Reversed",
          user: reversalTxn.createdBy,
          timestamp: reversalTxn.createdAt,
        });
      }
    }

    return NextResponse.json({
      success: true,
      transaction,
      breakdown,
      auditTrail,
    });
  } catch (error) {
    console.error("Transaction details error:", error);
    return NextResponse.json(
      { error: "Failed to fetch transaction details", details: error.message },
      { status: 500 }
    );
  }
}

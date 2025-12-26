import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import Member from "@/models/Member";
import Society from "@/models/Society";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";

export async function GET(request) {
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

    const searchParams = new URL(request.url).searchParams;
    const memberId = searchParams.get("memberId");

    if (!memberId) {
      return NextResponse.json(
        { error: "Member ID required" },
        { status: 400 }
      );
    }

    const member = await Member.findOne({
      _id: memberId,
      societyId: decoded.societyId,
    }).lean();

    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    // Get current balance
    const lastTransaction = await Transaction.findOne({
      memberId,
      societyId: decoded.societyId,
      isReversed: false,
    })
      .sort({ date: -1, createdAt: -1 })
      .lean();

    const principalAmount =
      lastTransaction?.balanceAfterTransaction ?? member.openingBalance ?? 0;

    if (principalAmount <= 0) {
      return NextResponse.json({
        principalAmount: 0,
        interestAmount: 0,
        totalOutstanding: 0,
        daysOverdue: 0,
        message: "No outstanding balance",
      });
    }

    // Calculate interest
    const society = await Society.findById(decoded.societyId).lean();
    const {
      interestRate,
      gracePeriodDays,
      billDueDay,
      interestCalculationMethod,
      interestCompoundingFrequency,
    } = society.config;

    let interestAmount = 0;
    let daysOverdue = 0;
    let dueDate = null;
    let graceEndDate = null;

    const oldestUnpaidBill = await Transaction.findOne({
      memberId,
      societyId: decoded.societyId,
      type: "Debit",
      category: "Maintenance",
      isReversed: false,
    })
      .sort({ date: 1 })
      .lean();

    if (oldestUnpaidBill) {
      const billDate = new Date(oldestUnpaidBill.date);
      dueDate = new Date(
        billDate.getFullYear(),
        billDate.getMonth(),
        billDueDay || 10
      );
      graceEndDate = new Date(dueDate);
      graceEndDate.setDate(graceEndDate.getDate() + (gracePeriodDays || 0));

      const now = new Date();
      if (now > graceEndDate) {
        daysOverdue = Math.floor((now - graceEndDate) / (1000 * 60 * 60 * 24));

        if (interestCalculationMethod === "SIMPLE") {
          const monthsOverdue = daysOverdue / 30;
          interestAmount =
            principalAmount * (interestRate / 100) * monthsOverdue;
        } else {
          const n = interestCompoundingFrequency === "DAILY" ? 30 : 1;
          const t = daysOverdue / 30;
          if (t > 0) {
            const r = interestRate / 100;
            const amount = principalAmount * Math.pow(1 + r / n, n * t);
            interestAmount = amount - principalAmount;
          }
        }

        interestAmount = Math.round(interestAmount * 100) / 100;
      }
    }

    return NextResponse.json({
      principalAmount,
      interestAmount,
      totalOutstanding: principalAmount + interestAmount,
      daysOverdue,
      dueDate,
      graceEndDate,
      interestRate,
      interestCalculationMethod,
      message:
        daysOverdue > 0
          ? `${daysOverdue} days overdue. Interest: ₹${interestAmount.toFixed(
              2
            )}`
          : "Within grace period",
    });
  } catch (error) {
    console.error("Outstanding calculation error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
}

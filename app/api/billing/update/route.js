import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import AuditLog from "@/models/AuditLog";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";

import { getFinancialYear } from "@/lib/date-utils";

export async function PUT(request) {
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
          error:
            "Insufficient permissions. Only Admin and Secretary can update bills.",
        },
        { status: 403 }
      );
    }

    const { billId, updates } = await request.json();

    if (!billId) {
      return NextResponse.json({ error: "Bill ID required" }, { status: 400 });
    }

    const existingBill = await Bill.findOne({
      _id: billId,
      societyId: decoded.societyId,
    });

    if (!existingBill) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }

    if (existingBill.isLocked) {
      return NextResponse.json(
        {
          error: "Cannot update locked bill. Period has been finalized.",
        },
        { status: 403 }
      );
    }

    const allowedUpdates = ["charges", "notes", "dueDate"];
    const updateData = {};

    Object.keys(updates).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        updateData[key] = updates[key];
      }
    });

    if (updates.charges) {
      const chargesMap = new Map(Object.entries(updates.charges));
      updateData.charges = chargesMap;

      let dynamicTotal = 0;
      for (const amount of chargesMap.values()) {
        dynamicTotal += parseFloat(amount) || 0;
      }

      const subtotal =
        existingBill.breakdown.maintenance +
        existingBill.breakdown.sinkingFund +
        existingBill.breakdown.repairFund +
        existingBill.breakdown.fixedCharges +
        dynamicTotal;

      const serviceTax =
        (subtotal * (existingBill.breakdown.serviceTaxRate || 0)) / 100;

      const newTotal =
        subtotal +
        serviceTax +
        existingBill.breakdown.previousArrears +
        existingBill.breakdown.interestOnArrears;

      updateData["breakdown.dynamicCharges"] = dynamicTotal;
      updateData.totalAmount = Math.round(newTotal * 100) / 100;
      updateData.balanceAmount =
        updateData.totalAmount - existingBill.amountPaid;
    }

    updateData.lastModifiedAt = new Date();
    updateData.lastModifiedBy = decoded.userId;

    const updatedBill = await Bill.findByIdAndUpdate(
      billId,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (updates.charges) {
      const lastTransaction = await Transaction.findOne({
        referenceId: billId,
        referenceModel: "Bill",
        type: "Debit",
        category: "Maintenance",
      }).sort({ date: -1 });

      if (lastTransaction) {
        const amountDifference =
          updatedBill.totalAmount - existingBill.totalAmount;

        if (amountDifference !== 0) {
          const previousBalance = lastTransaction.balanceAfterTransaction;
          const newBalance = previousBalance + amountDifference;

          await Transaction.create({
            transactionId: Transaction.generateTransactionId(),
            date: new Date(),
            memberId: updatedBill.memberId,
            societyId: decoded.societyId,
            type: amountDifference > 0 ? "Debit" : "Credit",
            category: "Adjustment",
            description: `Bill adjustment for ${updatedBill.billPeriodId} (${
              amountDifference > 0 ? "+" : ""
            }${amountDifference.toFixed(2)})`,
            amount: Math.abs(amountDifference),
            balanceAfterTransaction: newBalance,
            referenceId: billId,
            referenceModel: "Bill",
            billPeriodId: updatedBill.billPeriodId,
            paymentMode: "System",
            createdBy: decoded.userId,
            financialYear: getFinancialYear(new Date()),
          });
        }
      }
    }

    await AuditLog.create({
      userId: decoded.userId,
      societyId: decoded.societyId,
      action: "UPDATE_BILL",
      oldData: existingBill,
      newData: updatedBill,
      timestamp: new Date(),
    });

    return NextResponse.json({
      success: true,
      message: "Bill updated successfully",
      bill: updatedBill,
    });
  } catch (error) {
    console.error("Update bill error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error.message,
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
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

    if (decoded.role !== "Admin") {
      return NextResponse.json(
        {
          error: "Only Admin can delete bills",
        },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const billPeriodId = searchParams.get("billPeriodId");

    if (!billPeriodId) {
      return NextResponse.json(
        { error: "Bill period ID required" },
        { status: 400 }
      );
    }

    const billsToDelete = await Bill.find({
      societyId: decoded.societyId,
      billPeriodId,
      status: { $in: ["Unpaid", "Overdue"] },
    });

    if (billsToDelete.length === 0) {
      return NextResponse.json(
        {
          error: "No unpaid bills found for this period or bills already paid",
        },
        { status: 400 }
      );
    }

    const paidBills = await Bill.countDocuments({
      societyId: decoded.societyId,
      billPeriodId,
      status: { $in: ["Paid", "Partial"] },
    });

    if (paidBills > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete. ${paidBills} bills have payments. Reverse payments first.`,
        },
        { status: 400 }
      );
    }

    const billIds = billsToDelete.map((b) => b._id);

    await Transaction.updateMany(
      {
        societyId: decoded.societyId,
        referenceId: { $in: billIds },
        referenceModel: "Bill",
      },
      {
        $set: { isReversed: true },
      }
    );

    const deleteResult = await Bill.deleteMany({
      _id: { $in: billIds },
    });

    await AuditLog.create({
      userId: decoded.userId,
      societyId: decoded.societyId,
      action: "DELETE_BILLS",
      oldData: {
        billPeriodId,
        deletedCount: deleteResult.deletedCount,
      },
      timestamp: new Date(),
    });

    return NextResponse.json({
      success: true,
      message: `Successfully deleted ${deleteResult.deletedCount} bills`,
      deletedCount: deleteResult.deletedCount,
      billPeriodId,
    });
  } catch (error) {
    console.error("Delete bills error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error.message,
      },
      { status: 500 }
    );
  }
}

// PUT    /api/expenses/:id   — update an expense
// DELETE /api/expenses/:id   — soft-delete an expense
// Admin/Secretary only, scoped to the caller's society.
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import Expense from "@/models/Expense";
import { authorize } from "@/lib/rbac/authorize";
import { logAudit } from "@/lib/audit-logger";

const VALID_CATEGORIES = new Set([
  "Salary",
  "Security",
  "Housekeeping",
  "Repairs & Maintenance",
  "Electricity",
  "Water",
  "Lift/Elevator",
  "Garden",
  "Legal & Professional",
  "Audit",
  "Insurance",
  "Property Tax",
  "Bank Charges",
  "Festival & Events",
  "Miscellaneous",
]);

export async function PUT(request, { params }) {
  const gate = await authorize(request, "finance.expenditure.update");
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!mongoose.Types.ObjectId.isValid(id))
    return NextResponse.json({ error: "Valid id required" }, { status: 400 });
  try {
    await connectDB();
    const expense = await Expense.findOne({
      _id: id,
      societyId: gate.context.societyId,
      isDeleted: { $ne: true },
    });
    if (!expense)
      return NextResponse.json({ error: "Expense not found" }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    if (body.category !== undefined) {
      if (!VALID_CATEGORIES.has(String(body.category)))
        return NextResponse.json({ error: "Invalid category" }, { status: 400 });
      expense.category = body.category;
    }
    if (body.amount !== undefined) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount < 0)
        return NextResponse.json({ error: "Amount must be a non-negative number" }, { status: 400 });
      expense.amount = +amount.toFixed(2);
    }
    if (body.date !== undefined) {
      const date = new Date(body.date);
      if (isNaN(date.getTime()))
        return NextResponse.json({ error: "Invalid date" }, { status: 400 });
      expense.date = date;
      expense.periodId = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    }
    if (body.paymentMethod !== undefined) expense.paymentMethod = body.paymentMethod;
    if (body.vendor !== undefined) expense.vendor = String(body.vendor).trim();
    if (body.referenceNo !== undefined) expense.referenceNo = String(body.referenceNo).trim();
    if (body.description !== undefined) expense.description = String(body.description).trim();
    await expense.save();
    await logAudit(gate.context.userId, gate.context.societyId, "EXPENSE_UPDATED", null, {
      expenseId: String(expense._id),
    });
    return NextResponse.json({
      success: true,
      expense: { ...expense.toObject(), _id: String(expense._id) },
    });
  } catch (err) {
    console.error("Expense update error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const gate = await authorize(request, "finance.expenditure.delete");
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!mongoose.Types.ObjectId.isValid(id))
    return NextResponse.json({ error: "Valid id required" }, { status: 400 });
  try {
    await connectDB();
    const expense = await Expense.findOneAndUpdate(
      { _id: id, societyId: gate.context.societyId, isDeleted: { $ne: true } },
      { $set: { isDeleted: true } },
      { new: true },
    );
    if (!expense)
      return NextResponse.json({ error: "Expense not found" }, { status: 404 });
    await logAudit(gate.context.userId, gate.context.societyId, "EXPENSE_DELETED", null, {
      expenseId: String(expense._id),
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Expense delete error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

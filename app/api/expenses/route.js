// GET  /api/expenses?fy=2026  — list expenses for a financial year (Apr–Mar)
// POST /api/expenses          — record a new expense
import { NextResponse } from "next/server";
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

export async function GET(request) {
  const gate = await authorize(request, "finance.expenditure.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const fy = parseInt(searchParams.get("fy"), 10);
    const query = { societyId: gate.context.societyId, isDeleted: { $ne: true } };
    if (Number.isInteger(fy)) {
      query.date = {
        $gte: new Date(Date.UTC(fy, 3, 1)),
        $lt: new Date(Date.UTC(fy + 1, 3, 1)),
      };
    }
    const items = await Expense.find(query).sort({ date: -1 }).lean();
    const total = items.reduce((sum, e) => sum + (e.amount || 0), 0);
    const byCategory = {};
    for (const e of items) {
      byCategory[e.category] = (byCategory[e.category] || 0) + (e.amount || 0);
    }
    return NextResponse.json({
      items: items.map((e) => ({ ...e, _id: String(e._id) })),
      total,
      byCategory,
    });
  } catch (err) {
    console.error("Expense list error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request) {
  const gate = await authorize(request, "finance.expenditure.create");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json().catch(() => ({}));
    if (!VALID_CATEGORIES.has(String(body.category)))
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0)
      return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
    const date = body.date ? new Date(body.date) : new Date();
    if (isNaN(date.getTime()))
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    const periodId = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const expense = await Expense.create({
      societyId: gate.context.societyId,
      category: body.category,
      amount: +amount.toFixed(2),
      date,
      periodId,
      paymentMethod: body.paymentMethod || "Online",
      vendor: String(body.vendor || "").trim(),
      referenceNo: String(body.referenceNo || "").trim(),
      description: String(body.description || "").trim(),
      createdBy: gate.context.userId,
      createdByName: gate.context.name || gate.context.email || "",
    });
    await logAudit(gate.context.userId, gate.context.societyId, "EXPENSE_CREATED", null, {
      expenseId: String(expense._id),
      amount: expense.amount,
      category: expense.category,
    });
    return NextResponse.json({
      success: true,
      expense: { ...expense.toObject(), _id: String(expense._id) },
    });
  } catch (err) {
    console.error("Expense create error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

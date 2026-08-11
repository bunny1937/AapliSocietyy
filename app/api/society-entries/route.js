import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import SocietyEntry from "@/models/SocietyEntry";
// Registers the User schema in this lambda so populate("createdBy") cannot
// throw MissingSchemaError (was returning 500 on ledger/payment fetches).
import User from "@/models/User";
void User;
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { authorize, authorizeAny } from "@/lib/rbac/authorize";
// GET read by receipts and balance-sheet pages too, not just Ledger — same
// cross-page-dependency pattern as financial-years.
const SOCIETY_ENTRY_VIEW_IDS = [
  "finance.societyEntry.view",
  "finance.receipts.view",
  "billing.balanceSheet.view",
  "finance.ledger.view",
];
function auth(request) {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  return verifyToken(token);
}
// GET /api/society-entries?fy=2025
export async function GET(request) {
  const gate = await authorizeAny(request, SOCIETY_ENTRY_VIEW_IDS);
  if (!gate.ok) return gate.response;
  const decoded = auth(request);
  if (!decoded) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await connectDB();
  const { searchParams } = new URL(request.url);
  const fy = parseInt(searchParams.get("fy") || "0");
  const query = { societyId: gate.context.societyId || decoded.societyId };
  if (fy) query.fy = fy;
  const entries = await SocietyEntry.find(query)
    .populate("createdBy", "name")
    .sort({ createdAt: -1 })
    .lean();
  return NextResponse.json({ entries });
}
// POST /api/society-entries
export async function POST(request) {
  const gate = await authorize(request, "finance.societyEntry.create");
  if (!gate.ok) return gate.response;
  const decoded = auth(request);
  if (!decoded) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Legacy ["Admin","Secretary"] check removed: authorize() above
  // (finance.societyEntry.create) is the real gate now.
  const societyId = gate.context.societyId || decoded.societyId;
  await connectDB();
  const body = await request.json();
  const { fy, name, type, entryKind, amount, date, notes } = body;
  if (!fy || !name?.trim() || !entryKind || !amount) {
    return NextResponse.json({ error: "fy, name, entryKind, amount required" }, { status: 400 });
  }
  if (!["income", "expenditure"].includes(entryKind)) {
    return NextResponse.json({ error: "entryKind must be income or expenditure" }, { status: 400 });
  }
  if (isNaN(amount) || Number(amount) <= 0) {
    return NextResponse.json({ error: "amount must be positive number" }, { status: 400 });
  }
  const entry = await SocietyEntry.create({
    societyId,
    fy: Number(fy),
    name: name.trim(),
    type: type || "Custom",
    entryKind,
    amount: Number(amount),
    date: date ? new Date(date) : new Date(),
    notes: notes?.trim() || "",
    createdBy: decoded.userId,
  });
  return NextResponse.json({ success: true, entry });
}
// DELETE /api/society-entries?id=<entryId>
export async function DELETE(request) {
  const gate = await authorize(request, "finance.societyEntry.delete");
  if (!gate.ok) return gate.response;
  const decoded = auth(request);
  if (!decoded) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Legacy ["Admin","Secretary"] check removed: authorize() above
  // (finance.societyEntry.delete) is the real gate now.
  await connectDB();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const entry = await SocietyEntry.findOneAndDelete({ _id: id, societyId: gate.context.societyId || decoded.societyId });
  if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
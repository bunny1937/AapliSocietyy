import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import Bill from "@/models/Bill";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { safeConfigDate } from "@/utils/dateUtils";
import cache from "@/lib/cache";
import { authorize, authorizeAny } from "@/lib/rbac/authorize";
// GET is read by several finance/billing pages for peripheral display
// (society name in receipt/statement headers), not just the dedicated
// Society Config page — same cross-page-dependency pattern as financial-years.
const CONFIG_VIEW_IDS = [
  "society.config.view",
  "finance.receipts.view",
  "finance.receipt.view",
  "billing.importBills.view",
  "billing.config.view",
  "billing.template.view",
  "billing.dashboard.view",
  "society.systemTests.view",
];
const DAY_FIELDS = ["billGenerationDay", "paymentUploadDay", "billDueDay"];
const validateDays = (body) => DAY_FIELDS.flatMap((key) => {
  if (body[key] == null) return [];
  const value = Number(body[key]);
  return Number.isInteger(value) && value >= 1 && value <= 31 ? [] : [`${key} must be a whole number from 1 to 31`];
});
async function propagateOpenBillDueDates(societyId, billDueDay) {
  const bills = await Bill.find({ societyId, status: { $in: ["Scheduled", "Unpaid", "Partial", "PaymentDone"] }, isDeleted: { $ne: true } })
    .select("_id billYear billMonth").lean();
  if (!bills.length) return 0;
  const result = await Bill.bulkWrite(bills.map((bill) => ({ updateOne: {
    filter: { _id: bill._id },
    update: { $set: { dueDate: safeConfigDate(bill.billYear, Number(bill.billMonth) + 1, billDueDay) } },
  }})));
  return result.modifiedCount || 0;
}
export async function PUT(request) {
  const gate = await authorize(request, "society.config.update");
  if (!gate.ok) return gate.response;
  try {
    await connectDB(); const token = getTokenFromRequest(request); const decoded = token ? verifyToken(token) : null;
    if (!decoded) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // Legacy ["Admin","Secretary","Treasurer"] check removed: authorize()
    // above (society.config.update) is the real gate now.
    const societyId = gate.context.societyId || decoded.societyId;
    const body = await request.json(); const errors = validateDays(body);
    if (errors.length) return NextResponse.json({ error: "Invalid monthly schedule", errors }, { status: 400 });
    const $set = {}; for (const key of DAY_FIELDS) if (body[key] != null) $set[`config.${key}`] = Number(body[key]);
    if (!Object.keys($set).length) return NextResponse.json({ error: "No schedule fields supplied" }, { status: 400 });
    const society = await Society.findByIdAndUpdate(societyId, { $set, $inc: { configVersion: 1 } }, { new: true, runValidators: true });
    const openBillsUpdated = body.billDueDay != null ? await propagateOpenBillDueDates(societyId, Number(body.billDueDay)) : 0;
    await cache.del(`society:config:${societyId}`);
    return NextResponse.json({ success: true, society, openBillsUpdated });
  } catch (error) { return NextResponse.json({ error: error.message }, { status: 500 }); }
}
export async function GET(request) {
  const gate = await authorizeAny(request, CONFIG_VIEW_IDS);
  if (!gate.ok) return gate.response;
  try {
    await connectDB(); const token = getTokenFromRequest(request); if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token); if (!decoded) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const societyId = gate.context.societyId || decoded.societyId;
    const cacheKey = `society:config:${societyId}`;
    const society = await cache.getOrSet(cacheKey, () => Society.findById(societyId).lean(), 900);
    if (!society) return NextResponse.json({ error: "Society not found" }, { status: 404 });
    return NextResponse.json({ society });
  } catch { return NextResponse.json({ error: "Internal server error" }, { status: 500 }); }
}

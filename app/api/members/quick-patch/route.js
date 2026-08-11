import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import BillingHead from "@/models/BillingHead";
import Bill from "@/models/Bill";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import cache from "@/lib/cache";
import { calculateMemberCharges } from "@/lib/calculate-member-bill";
import { validateBillInvariants } from "@/lib/billing/invariants";
import { correctBillHistorical } from "@/lib/billing/correctionService";
import { authorizeAny } from "@/lib/rbac/authorize";
export async function POST(request) {
  try {
    // Also called from Generate Bills (inline area/parking fix before
    // generating), not just View/Edit Members.
    const gate = await authorizeAny(request, ["member.member.update", "billing.dashboard.view"]);
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    // Legacy "Admin only" check removed: authorize() above (member.member.update)
    // is the real gate — it correctly allows any role RBAC granted this to,
    // not just the literal legacy string "Admin".
    const societyId = gate.context.societyId || decoded.societyId;
    const { memberId, carpetAreaSqft, parkingSlots, recalcBillPeriodId } = await request.json();
    if (!memberId) return NextResponse.json({ error: "memberId required" }, { status: 400 });
    const patch = {};
    if (carpetAreaSqft !== undefined) patch.carpetAreaSqft = Number(carpetAreaSqft);
    if (parkingSlots !== undefined) patch.parkingSlots = parkingSlots;
    const member = await Member.findOneAndUpdate(
      { _id: memberId, societyId },
      { $set: patch },
      { new: true },
    );
    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    await cache.delPattern(`members:list:${societyId}:*`);
    let billRecalculated = false;
    if (recalcBillPeriodId) {
      const existingBill = await Bill.findOne({
        memberId,
        societyId,
        billPeriodId: recalcBillPeriodId,
        isDeleted: { $ne: true },
      });
      if (existingBill && (existingBill.amountPaid || 0) > 0) {
        return NextResponse.json(
          {
            error:
              "This bill already has a payment recorded — recalculating charges now would overwrite the payment's effect on the closing balance. Use the audited bill-correction workflow instead.",
          },
          { status: 409 },
        );
      }
      if (existingBill) {
        const heads = await BillingHead.find({
          societyId,
          isActive: true,
          isDeleted: false,
        }).sort({ order: 1 }).lean();
        const { subtotal, breakdown } = calculateMemberCharges(member.toObject(), heads);
        const newCurrentCharges = parseFloat(subtotal.toFixed(2));
        const openingPrincipal = parseFloat((existingBill.openingPrincipal || 0).toFixed(2));
        const openingInterest = parseFloat((existingBill.openingInterest || 0).toFixed(2));
        // currentInterest is NOT recomputed here — a member data edit (area/
        // parking) changes currentCharges only, never interest (§10: interest
        // depends solely on openingPrincipal, which this edit doesn't touch).
        const currentInterest = parseFloat((existingBill.currentInterest ?? 0).toFixed(2));
        const newBillPrincipal = parseFloat((openingPrincipal + newCurrentCharges).toFixed(2));
        const newBillInterest = parseFloat((openingInterest + currentInterest).toFixed(2));
        const newTotalBillDue = parseFloat((newBillPrincipal + newBillInterest).toFixed(2));
        const alreadyPaid = parseFloat((existingBill.amountPaid || 0).toFixed(2));
        const advApplied = parseFloat((existingBill.advanceApplied || 0).toFixed(2));
        const newBalance = parseFloat(Math.max(0, newTotalBillDue - alreadyPaid - advApplied).toFixed(2));
        const newStatus = newBalance <= 0.005 ? "Paid" : alreadyPaid > 0 || advApplied > 0 ? "Partial" : "Unpaid";
        const chargesObj = Object.fromEntries(
          Object.entries(breakdown).map(([k, v]) => [k, parseFloat(v) || 0]),
        );

        // Ledger V2 (§6/§8): validate before writing, and go through the
        // audited correction workflow — never a bare $set on a generated
        // bill's monetary fields.
        validateBillInvariants({
          openingPrincipal,
          openingInterest,
          currentCharges: newCurrentCharges,
          currentInterest,
          totalBillDue: newTotalBillDue,
          closingPrincipal: newBillPrincipal,
          closingInterest: newBillInterest,
          balanceAmount: newBalance,
          charges: chargesObj,
        });

        await correctBillHistorical({
          bill: existingBill,
          corrected: {
            currentCharges: newCurrentCharges,
            subtotal: newCurrentCharges,
            currentBillTotal: newCurrentCharges,
            billPrincipalBalance: newBillPrincipal,
            billInterestBalance: newBillInterest,
            totalBillDue: newTotalBillDue,
            totalAmount: newTotalBillDue,
            closingPrincipal: newBillPrincipal,
            closingInterest: newBillInterest,
            closingTotal: newTotalBillDue,
            balanceAmount: newBalance,
            status: newStatus,
            charges: new Map(Object.entries(chargesObj)),
          },
          reason: `Member data corrected (carpetAreaSqft/parkingSlots) — bill charges recalculated from BillingHeads for period ${recalcBillPeriodId}`,
          performedBy: decoded.userId,
        });
        billRecalculated = true;
      }
    }
    return NextResponse.json({ member: member.toObject(), billRecalculated });
  } catch (err) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

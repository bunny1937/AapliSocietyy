// lib/billing/memberBillRecalc.js
//
// Re-runs an already-generated bill's CURRENT CHARGES after the member data it
// was calculated from changed (carpet area, parking slots, membership status).
//
// Extracted from /api/members/quick-patch so the member-detail parking editor
// and the quick-patch endpoint cannot drift on the two rules that matter here:
//
//   1. A bill with a payment against it is never silently recalculated —
//      rewriting its charges would change the closing balance the payment was
//      applied to. That is the audited correction workflow's job, not this.
//   2. Interest is NOT recomputed. A member-data edit changes currentCharges
//      only; interest depends solely on openingPrincipal, which this never
//      touches (Ledger V2 §10).
//
// Writes go through correctBillHistorical(), never a bare $set on a generated
// bill's monetary fields (§6/§8).

import BillingHead from "@/models/BillingHead";
import Bill from "@/models/Bill";
import { calculateMemberCharges } from "@/lib/calculate-member-bill";
import { validateBillInvariants } from "@/lib/billing/invariants";
import { correctBillHistorical } from "@/lib/billing/correctionService";

const twoDp = (n) => parseFloat((Number(n) || 0).toFixed(2));

export class BillLockedError extends Error {
  constructor(message) {
    super(message);
    this.name = "BillLockedError";
    this.code = "BILL_HAS_PAYMENT";
    this.status = 409;
  }
}

/**
 * @param member        a live (non-lean) Member document, already saved
 * @param societyId
 * @param billPeriodId  e.g. "2026-08". Falsy = do nothing.
 * @param performedBy   userId for the correction audit trail
 * @param reason        what changed, in the words that belong in the audit log
 * @returns {Promise<{ recalculated: boolean, reason?: string }>}
 * @throws {BillLockedError} when the period's bill already carries a payment
 */
export async function recalcMemberBillForPeriod({
  member,
  societyId,
  billPeriodId,
  performedBy,
  reason,
}) {
  if (!billPeriodId) return { recalculated: false, reason: "No bill period given." };

  const existingBill = await Bill.findOne({
    memberId: member._id,
    societyId,
    billPeriodId,
    isDeleted: { $ne: true },
  });

  if (!existingBill) {
    return {
      recalculated: false,
      reason: `No ${billPeriodId} bill exists for this flat yet, so there was nothing to recalculate. The change will apply when that bill is generated.`,
    };
  }

  if ((existingBill.amountPaid || 0) > 0) {
    throw new BillLockedError(
      "This bill already has a payment recorded — recalculating charges now would overwrite the payment's effect on the closing balance. Use the audited bill-correction workflow instead.",
    );
  }

  const heads = await BillingHead.find({ societyId, isActive: true, isDeleted: false })
    .sort({ order: 1 })
    .lean();

  const { subtotal, breakdown } = calculateMemberCharges(
    typeof member.toObject === "function" ? member.toObject() : member,
    heads,
  );

  const newCurrentCharges = twoDp(subtotal);
  const openingPrincipal = twoDp(existingBill.openingPrincipal);
  const openingInterest = twoDp(existingBill.openingInterest);
  const currentInterest = twoDp(existingBill.currentInterest ?? 0);
  const newBillPrincipal = twoDp(openingPrincipal + newCurrentCharges);
  const newBillInterest = twoDp(openingInterest + currentInterest);
  const newTotalBillDue = twoDp(newBillPrincipal + newBillInterest);
  const alreadyPaid = twoDp(existingBill.amountPaid);
  const advApplied = twoDp(existingBill.advanceApplied);
  const newBalance = twoDp(Math.max(0, newTotalBillDue - alreadyPaid - advApplied));
  const newStatus =
    newBalance <= 0.005 ? "Paid" : alreadyPaid > 0 || advApplied > 0 ? "Partial" : "Unpaid";

  const chargesObj = Object.fromEntries(
    Object.entries(breakdown).map(([k, v]) => [k, parseFloat(v) || 0]),
  );

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
    reason:
      reason ||
      `Member data corrected — bill charges recalculated from BillingHeads for period ${billPeriodId}`,
    performedBy,
  });

  return { recalculated: true, newCurrentCharges, newTotalBillDue, newBalance };
}

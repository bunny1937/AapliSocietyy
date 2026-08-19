import mongoose from "mongoose";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import AuditEvent from "@/models/AuditEvent";
import { validateBillInvariants } from "@/lib/billing/invariants";
import { allocatePayment, deriveStatus } from "./allocation-math.js";
import { isDuplicateKeyError } from "@/lib/mongoErrors";

export const ENGINE_VERSION = "Ledger V2";
export const CALCULATION_VERSION = 1;
const twoDp = (n) => parseFloat((Number(n) || 0).toFixed(2));

export { allocatePayment, deriveStatus };

// Atomic, EXACTLY-ONCE single-bill payment application (§4/§7/§8/§9).
//
// Idempotency guarantees (when a paymentImportId is supplied):
//   - The unique index { billId, paymentImportId, eventType } on AuditEvent is
//     the hard lock. The PAYMENT_ALLOCATED audit event is inserted FIRST inside
//     the same atomic unit as the bill mutation and the advance-credit increment.
//   - If the same (bill, import) is applied again — duplicate Excel upload,
//     retry, or a race that slips past the fast-path pre-check — the second
//     insert throws E11000, the whole transaction aborts, and we return
//     { skipped: "duplicate_import" } with ZERO side effects. So a payment can
//     never be applied twice, no duplicate audit event is created, and advance
//     credit is never incremented twice.
//   - Callers create ledger Transactions/Receipts only when this returns a
//     non-skipped result, so duplicate transactions are impossible too.
// §9 concurrency note: the read (closingPrincipal/closingInterest snapshot)
// and the write happen in separate steps, so two concurrent calls on the
// SAME bill can both read the same starting state and race. Guarded with an
// optimistic-concurrency retry: the update's filter requires the bill's
// closing values to still match what was read; if a concurrent write already
// moved them, 0 documents match, and this re-reads + recomputes + retries.
const MAX_CONCURRENCY_RETRIES = 5;

export async function applyPaymentToBill({ billId, payment, paymentImportId, performedBy }) {
  for (let attempt = 0; attempt < MAX_CONCURRENCY_RETRIES; attempt++) {
    const result = await attemptPayment({ billId, payment, paymentImportId, performedBy });
    if (result !== "RETRY") return result;
  }
  const e = new Error("Payment allocation could not complete — too much concurrent write contention on this bill");
  e.code = "CONCURRENCY_EXHAUSTED";
  throw e;
}

async function attemptPayment({ billId, payment, paymentImportId, performedBy }) {
  const bill = await Bill.findById(billId);
  if (!bill) {
    const e = new Error("Bill not found");
    e.code = "BILL_NOT_FOUND";
    throw e;
  }
  if (bill.status === "Paid") return { billId, skipped: "already_paid" };

  // Fast-path pre-check (cheap). The unique index below is the real guarantee.
  if (paymentImportId) {
    const dup = await AuditEvent.findOne({ billId, paymentImportId, eventType: "PAYMENT_ALLOCATED" }).lean();
    if (dup) return { billId, skipped: "duplicate_import" };
  }

  const beforeP = twoDp(bill.closingPrincipal);
  const beforeI = twoDp(bill.closingInterest);
  const beforeAmountPaid = twoDp(bill.amountPaid);
  const r = allocatePayment({ closingPrincipal: beforeP, closingInterest: beforeI, payment });
  const amountPaid = twoDp(beforeAmountPaid + r.appliedToBill);
  const status = deriveStatus({ balanceAmount: r.balanceAmount, amountPaid });

  // Invariant B2 must hold after allocation (B1/B3 untouched by payment).
  validateBillInvariants({
    openingPrincipal: bill.openingPrincipal,
    openingInterest: bill.openingInterest,
    currentCharges: bill.currentCharges,
    currentInterest: bill.currentInterest,
    totalBillDue: bill.totalBillDue,
    closingPrincipal: r.closingPrincipal,
    closingInterest: r.closingInterest,
    balanceAmount: r.balanceAmount,
  });

  const $set = {
    closingPrincipal: r.closingPrincipal,
    closingInterest: r.closingInterest,
    closingTotal: r.balanceAmount,
    balanceAmount: r.balanceAmount,
    amountPaid,
    status,
    // dual-write legacy fields (migration window)
    principalBalance: r.closingPrincipal,
    interestBalance: r.closingInterest,
    paymentUploadedAt: new Date(),
    ...(paymentImportId ? { paymentImportId } : {}),
  };
  const auditDoc = {
    billId: bill._id,
    societyId: bill.societyId,
    memberId: bill.memberId,
    eventType: "PAYMENT_ALLOCATED",
    timestamp: new Date(),
    performedBy: performedBy || "System",
    calculationVersion: bill.calculationVersion || CALCULATION_VERSION,
    engineVersion: ENGINE_VERSION,
    paymentAmount: twoDp(payment),
    ...(paymentImportId ? { paymentImportId } : {}),
    closingPrincipalBefore: beforeP,
    closingPrincipalAfter: r.closingPrincipal,
    closingInterestBefore: beforeI,
    closingInterestAfter: r.closingInterest,
  };

  // Optimistic-concurrency filter: only apply if the bill's closing state
  // still matches what was just read. A concurrent writer changing it first
  // makes this match 0 documents — signal the caller to retry from scratch.
  const casFilter = {
    _id: bill._id,
    closingPrincipal: beforeP,
    closingInterest: beforeI,
    amountPaid: beforeAmountPaid,
  };

  function finish() {
    return {
      billId,
      status,
      amountPaid,
      interestPaid: r.interestPaid,
      principalPaid: r.principalPaid,
      advanceCredit: r.advanceCredit,
      closingPrincipal: r.closingPrincipal,
      closingInterest: r.closingInterest,
      balanceAmount: r.balanceAmount,
    };
  }

  const session = await mongoose.startSession();
  let concurrencyConflict = false;
  try {
    await session.withTransaction(async () => {
      // Audit FIRST: the unique index is the idempotency lock. A duplicate
      // (bill, import) throws E11000 here and aborts the whole transaction
      // before any bill mutation or advance-credit increment happens.
      await AuditEvent.create([auditDoc], { session });
      const updateRes = await Bill.updateOne(casFilter, { $set }, { session });
      if (updateRes.matchedCount === 0) {
        concurrencyConflict = true;
        throw new Error("CONCURRENCY_CONFLICT");
      }
      if (r.advanceCredit > 0)
        await Member.updateOne({ _id: bill.memberId }, { $inc: { advanceCredit: r.advanceCredit } }, { session });
    });
    session.endSession();
    if (concurrencyConflict) return "RETRY";
    return finish();
  } catch (txErr) {
    session.endSession();
    if (concurrencyConflict) return "RETRY";
    if (isDuplicateKeyError(txErr)) {
      return { billId, skipped: "duplicate_import" };
    }
    if (/Transaction numbers|replica set|not supported/i.test(txErr.message || "")) {
      // Standalone Mongo (no transactions): still audit-FIRST so a duplicate is
      // rejected before any mutation. This prioritises "never apply twice" over
      // "never under-apply" (which only matters on a mid-write crash here).
      try {
        await AuditEvent.create([auditDoc]);
      } catch (auditErr) {
        if (isDuplicateKeyError(auditErr)) return { billId, skipped: "duplicate_import" };
        throw auditErr;
      }
      const updateRes = await Bill.updateOne(casFilter, { $set });
      if (updateRes.matchedCount === 0) {
        // Audit event already written for this attempt but the bill moved
        // under us — orphaned-but-harmless (proves an attempt happened); the
        // retry writes a fresh, correct audit event against the new state.
        return "RETRY";
      }
      if (r.advanceCredit > 0)
        await Member.updateOne({ _id: bill.memberId }, { $inc: { advanceCredit: r.advanceCredit } });
      return finish();
    }
    throw txErr;
  }
}

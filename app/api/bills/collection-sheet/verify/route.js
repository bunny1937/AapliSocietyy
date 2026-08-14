// app/api/bills/collection-sheet/verify/route.js
//
// Row-by-row validation for the Collections grid.
//
// This is the anti-tamper wall. The client sends ONLY:
//   { billId, amountPaid, mode, remarks, sig }
//
// It does not send billDue, openingDue, currentCharges or remainingDue. Those
// are re-read from the database here. The `sig` proves the numbers the admin
// was LOOKING AT when they typed still match the numbers in the database, so
// we can reject a stale sheet without trusting a single client-supplied figure.
//
// The five checks, in order:
//
//   1. SIGNATURE  - the locked columns were not edited in the browser, and the
//                   billing config has not changed since the sheet was built.
//   2. FRESHNESS  - the bill has not been paid by someone else since.
//   3. MODE GATE  - mode empty  => this row is a declaration of UNPAID.
//                   mode filled => this row is a declaration of PAID/PARTIAL.
//   4. RECONCILE  - what the admin declared must agree with what the member
//                   already did through the member app / payment gateway.
//   5. BOUNDS     - amountPaid is a real number, > 0 when a mode is given,
//                   and never more than what is actually outstanding.
//
// Nothing is written. This route is a pure validator; the grid calls it as
// many times as the admin wants. Committing is a separate explicit action.

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { authorize } from "@/lib/rbac/authorize";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import { getSocietySnapshot } from "@/lib/import/societySnapshot";
import { verifyRow, configFingerprint, money } from "@/lib/billing/ledgerSignature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VALID_MODES = ["Cash", "Cheque", "NEFT", "IMPS", "UPI", "Card", "Online"];
const MAX_ROWS_PER_CALL = 60;
const TOLERANCE = 0.01; // one paisa, for float noise only

function fail(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}

export async function POST(request) {
  try {
    const gate = await authorize(request, "billing.bill.generate");
    if (!gate.ok) return gate.response;
    const societyId = gate.context.societyId;

    const body = await request.json();
    const { periodId, fingerprint, rows, billSeries = "RESIDENTIAL" } = body || {};

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "No rows submitted" }, { status: 400 });
    }
    if (rows.length > MAX_ROWS_PER_CALL) {
      return NextResponse.json(
        {
          error: `Send at most ${MAX_ROWS_PER_CALL} rows per call`,
          code: "BATCH_TOO_LARGE",
        },
        { status: 400 },
      );
    }

    await connectDB();

    const snapshot = await getSocietySnapshot(societyId);
    const currentFingerprint = configFingerprint({
      config: snapshot.config,
      heads: snapshot.heads,
    });

    // ---- Check 1a, global: has billing config moved under our feet? ------
    // This is the "locked forever UNLESS billing config changes" clause. If it
    // changed, every row in the sheet is stale, so we refuse the whole batch
    // rather than half-accepting it.
    if (fingerprint && fingerprint !== currentFingerprint) {
      return NextResponse.json(
        {
          error: "Billing configuration changed since this sheet was opened.",
          code: "STALE_FINGERPRINT",
          action: "REFETCH",
          currentFingerprint,
        },
        { status: 409 },
      );
    }

    // ---- One read for the whole batch, not one per row -------------------
    const billIds = rows.map((r) => String(r.billId)).filter(Boolean);

    const bills = await Bill.find({ societyId, _id: { $in: billIds } })
      .select(
        "memberId billPeriodId billSeries totalBillDue amountPaid status openingPrincipal openingInterest currentCharges billPrincipal",
      )
      .lean();
    const billMap = new Map(bills.map((b) => [String(b._id), b]));

    const payAgg = await Transaction.aggregate([
      {
        $match: {
          societyId,
          billId: { $in: bills.map((b) => b._id) },
          type: { $in: ["PAYMENT", "Payment", "payment"] },
          isReversed: { $ne: true },
        },
      },
      {
        $group: {
          _id: "$billId",
          paid: { $sum: "$amount" },
          lastMode: { $last: "$mode" },
          sources: { $addToSet: "$source" },
          count: { $sum: 1 },
        },
      },
    ]);
    const paidMap = new Map(payAgg.map((p) => [String(p._id), p]));

    // ---- Per-row, all in memory ------------------------------------------
    const results = rows.map((input) => {
      const billId = String(input.billId || "");
      const base = { billId, flat: input.flat || "" };

      const bill = billMap.get(billId);
      if (!bill) {
        return {
          ...base,
          ...fail("BILL_NOT_FOUND", "This bill no longer exists. Refresh the sheet."),
        };
      }
      if (periodId && bill.billPeriodId !== periodId) {
        return {
          ...base,
          ...fail("WRONG_PERIOD", "This bill belongs to a different billing period."),
        };
      }
      if (billSeries && bill.billSeries !== billSeries) {
        return {
          ...base,
          ...fail("WRONG_SERIES", "This bill does not belong to the selected billing segment (residential/commercial)."),
        };
      }

      // Recompute the locked columns from the database. The client's copies
      // are never read.
      const pay = paidMap.get(billId);
      const openingDue = money(
        (bill.openingPrincipal || 0) + (bill.openingInterest || 0),
      );
      const currentCharges = money(
        bill.currentCharges != null
          ? bill.currentCharges
          : (bill.billPrincipal || 0) - (bill.openingPrincipal || 0),
      );
      const billDue = money(bill.totalBillDue);
      const alreadyPaid = money(pay?.paid ?? bill.amountPaid ?? 0);
      const remainingDue = money(Math.max(0, billDue - alreadyPaid));

      let systemStatus = "UNPAID";
      if (alreadyPaid >= billDue && billDue > 0) systemStatus = "PAID";
      else if (alreadyPaid > 0) systemStatus = "PARTIAL";

      const ledger = {
        billId,
        memberId: String(bill.memberId),
        periodId: bill.billPeriodId,
        openingDue,
        currentCharges,
        billDue,
        remainingDue,
        alreadyPaid,
        systemStatus,
      };

      // ---- CHECK 1: signature ------------------------------------------
      // If the admin opened devtools and changed Remaining Due from 8,400 to
      // 400, the recomputed HMAC will not match what the client sent back.
      if (!verifyRow(ledger, currentFingerprint, input.sig)) {
        return {
          ...base,
          ...fail(
            "TAMPERED",
            "The locked ledger values for this row do not match the server. The row was edited outside the allowed fields, or someone else recorded a payment while this sheet was open.",
            { action: "REFETCH", server: ledger },
          ),
        };
      }

      // ---- Normalise the three editable fields --------------------------
      const modeRaw = String(input.mode || "").trim();
      const remarks = String(input.remarks || "").trim().slice(0, 240);
      const hasMode = modeRaw.length > 0;

      const amtRaw = input.amountPaid;
      const amtProvided =
        amtRaw !== null && amtRaw !== undefined && String(amtRaw).trim() !== "";
      const amountPaid = amtProvided ? money(amtRaw) : 0;

      if (amtProvided && !Number.isFinite(Number(amtRaw))) {
        return { ...base, ...fail("AMOUNT_NAN", "Amount Paid must be a number.") };
      }
      if (amountPaid < 0) {
        return { ...base, ...fail("AMOUNT_NEGATIVE", "Amount Paid cannot be negative.") };
      }
      if (hasMode && !VALID_MODES.includes(modeRaw)) {
        return {
          ...base,
          ...fail("MODE_INVALID", `Mode must be one of: ${VALID_MODES.join(", ")}`),
        };
      }

      // ---- CHECK 3: the mode gate ---------------------------------------
      // "verify that payment mode is empty then mark it as paid or unpaid"
      //
      // Empty mode is not "no opinion". It is an explicit declaration that no
      // payment was collected at the desk for this flat. So an amount without
      // a mode is contradictory and is rejected rather than silently ignored.
      if (!hasMode && amountPaid > 0) {
        return {
          ...base,
          ...fail(
            "AMOUNT_WITHOUT_MODE",
            "An amount was entered but no payment mode was selected. Pick a mode, or clear the amount to mark this flat unpaid.",
          ),
        };
      }

      // ================= BRANCH A: mode empty => UNPAID ==================
      if (!hasMode) {
        // CHECK 4A: the admin says nothing was collected. But the member may
        // have paid from the app ten minutes ago. Declaring that flat unpaid
        // would wipe a real payment off the collection register.
        if (systemStatus === "PAID") {
          return {
            ...base,
            ...fail(
              "CONTRADICTS_MEMBER_PAYMENT",
              `This flat already paid ${inr(alreadyPaid)} in full${
                pay?.sources?.includes("MEMBER_APP") ? " from the member app" : ""
              }. It cannot be marked unpaid. Leave the row untouched or reverse the payment first.`,
              { server: ledger },
            ),
          };
        }
        if (systemStatus === "PARTIAL") {
          return {
            ...base,
            ...fail(
              "CONTRADICTS_PARTIAL_PAYMENT",
              `This flat has already paid ${inr(alreadyPaid)} of ${inr(billDue)}. Marking it unpaid would discard that. Enter the balance ${inr(remainingDue)} with a mode, or leave the row blank.`,
              { server: ledger },
            ),
          };
        }

        return {
          ...base,
          ok: true,
          resolvedStatus: "UNPAID",
          willRecord: null,
          amountPaid: 0,
          mode: "",
          remarks,
          server: ledger,
          note: `No collection recorded. ${inr(remainingDue)} carries forward as opening due next month.`,
        };
      }

      // ============= BRANCH B: mode filled => PAID / PARTIAL =============
      if (amountPaid <= 0) {
        return {
          ...base,
          ...fail(
            "MODE_WITHOUT_AMOUNT",
            "A payment mode was selected but no amount was entered.",
          ),
        };
      }

      // CHECK 5: bounds. This is the hard stop on amountPaid tampering.
      // remainingDue came from the database, not the browser.
      if (amountPaid > remainingDue + TOLERANCE) {
        return {
          ...base,
          ...fail(
            "AMOUNT_EXCEEDS_DUE",
            `Entered ${inr(amountPaid)} but only ${inr(remainingDue)} is outstanding${
              alreadyPaid > 0 ? ` (${inr(alreadyPaid)} already received)` : ""
            }. Overpayment must be recorded as advance credit from the Payments screen.`,
            { server: ledger, maxAllowed: remainingDue },
          ),
        };
      }

      // CHECK 4B: the flat is already settled in full. Any further entry is a
      // double-count, whichever direction it goes.
      if (systemStatus === "PAID") {
        return {
          ...base,
          ...fail(
            "ALREADY_SETTLED",
            `Already paid in full (${inr(alreadyPaid)}${
              pay?.lastMode ? `, ${pay.lastMode}` : ""
            }${pay?.sources?.includes("MEMBER_APP") ? ", member app" : ""}). Nothing further can be collected against this bill.`,
            { server: ledger },
          ),
        };
      }

      // Partial top-up is legitimate: member paid some online, pays the rest
      // at the desk. We only require that the two together do not exceed the
      // bill, which CHECK 5 above already guarantees.
      const totalAfter = money(alreadyPaid + amountPaid);
      const resolvedStatus =
        totalAfter >= billDue - TOLERANCE ? "PAID" : "PARTIAL";

      // A partial payment with no explanation is the single most common source
      // of "why is this flat short" disputes three months later.
      if (resolvedStatus === "PARTIAL" && !remarks) {
        return {
          ...base,
          ...fail(
            "PARTIAL_NEEDS_REMARK",
            `${inr(amountPaid)} against ${inr(remainingDue)} leaves ${inr(money(remainingDue - amountPaid))} outstanding. Add a remark explaining the short payment.`,
            { server: ledger },
          ),
        };
      }

      if (modeRaw === "Cheque" && !remarks) {
        return {
          ...base,
          ...fail(
            "CHEQUE_NEEDS_REFERENCE",
            "Cheque payments need the cheque number and bank in Remarks.",
          ),
        };
      }

      return {
        ...base,
        ok: true,
        resolvedStatus,
        willRecord: {
          amount: amountPaid,
          mode: modeRaw,
          remarks,
          appliesTo: billId,
        },
        amountPaid,
        mode: modeRaw,
        remarks,
        server: ledger,
        note:
          resolvedStatus === "PAID"
            ? alreadyPaid > 0
              ? `Settles the balance. ${inr(alreadyPaid)} online + ${inr(amountPaid)} ${modeRaw} = ${inr(totalAfter)}.`
              : `Full payment of ${inr(amountPaid)} by ${modeRaw}.`
            : `Part payment. ${inr(money(billDue - totalAfter))} will carry forward.`,
      };
    });

    const passed = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);

    return NextResponse.json({
      success: true,
      fingerprint: currentFingerprint,
      checked: results.length,
      passedCount: passed.length,
      failedCount: failed.length,
      needsRefetch: failed.some((f) => f.action === "REFETCH"),
      totalToCollect: money(
        passed.reduce((s, r) => s + (r.willRecord?.amount || 0), 0),
      ),
      results,
    });
  } catch (error) {
    console.error("collection-sheet/verify error:", error);
    return NextResponse.json(
      { error: "Verification failed" },
      { status: 500 },
    );
  }
}

function inr(n) {
  return `Rs ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

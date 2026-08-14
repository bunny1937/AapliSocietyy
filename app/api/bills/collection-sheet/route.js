// app/api/bills/collection-sheet/route.js
//
// Replaces the Excel download/upload round trip.
//
// GET  -> build the collection sheet for a period, once, server-side.
//         Every row arrives with its four ledger columns already computed,
//         its member-side payment status already resolved, and an HMAC that
//         locks all of it.
//
// The client caches the response and reuses it until `fingerprint` changes.
// That is the "already fetched one time until real data changes" behaviour:
// the fingerprint is derived from billing config + heads, so editing a
// billing head invalidates every open grid automatically.
//
// Cost: 1 aggregation + 1 cached snapshot read. The old flow was a template
// download, a manual edit, a re-upload, an XLSX parse, and a full re-validate
// on every retry.

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { authorize } from "@/lib/rbac/authorize";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import { getSocietySnapshot } from "@/lib/import/societySnapshot";
import { signRow, configFingerprint, money } from "@/lib/billing/ledgerSignature";
import cache from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request) {
  try {
    const gate = await authorize(request, "billing.dashboard.view");
    if (!gate.ok) return gate.response;
    const societyId = gate.context.societyId;

    const { searchParams } = new URL(request.url);
    const periodId = searchParams.get("periodId")?.trim();
    if (!periodId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodId)) {
      return NextResponse.json(
        { error: "periodId is required in YYYY-MM form" },
        { status: 400 },
      );
    }

    const billSeries = searchParams.get("billSeries") === "COMMERCIAL" ? "COMMERCIAL" : "RESIDENTIAL";

    await connectDB();

    const snapshot = await getSocietySnapshot(societyId);
    const fingerprint = configFingerprint({
      config: snapshot.config,
      heads: snapshot.heads,
    });

    // Server-side cache keyed on the fingerprint. Two admins opening the grid
    // in the same minute cost one build, not two.
    const cacheKey = `collection:sheet:${societyId}:${billSeries}:${periodId}:${fingerprint}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return NextResponse.json({ ...cached, cached: true });
    }

    // ---- One aggregation for the whole period ---------------------------
    // Bills for this period, plus every payment already applied to them,
    // plus whatever the member paid from the member app. No per-member loop.
    const bills = await Bill.find({ societyId, billPeriodId: periodId, billSeries })
      .select(
        "memberId billPeriodId billPrincipal billInterest totalBillDue amountPaid status openingPrincipal openingInterest currentCharges advanceApplied dueDate",
      )
      .lean();

    if (bills.length === 0) {
      return NextResponse.json(
        {
          error: "No bills generated for this period yet",
          code: "NO_BILLS",
          periodId,
        },
        { status: 409 },
      );
    }

    const billIds = bills.map((b) => b._id);

    // Member-side payments. This is the source of truth for "they already
    // paid" and it is what the admin must not be able to contradict.
    const paymentAgg = await Transaction.aggregate([
      {
        $match: {
          societyId,
          billId: { $in: billIds },
          type: { $in: ["PAYMENT", "Payment", "payment"] },
          isReversed: { $ne: true },
        },
      },
      {
        $group: {
          _id: "$billId",
          paid: { $sum: "$amount" },
          lastMode: { $last: "$mode" },
          lastDate: { $max: "$date" },
          sources: { $addToSet: "$source" },
          count: { $sum: 1 },
        },
      },
    ]);

    const paidByBill = new Map(paymentAgg.map((p) => [String(p._id), p]));

    const rows = bills
      .map((b) => {
        const m = snapshot.byId?.[String(b.memberId)];
        const pay = paidByBill.get(String(b._id));

        const openingDue = money(
          (b.openingPrincipal || 0) + (b.openingInterest || 0),
        );
        const currentCharges = money(
          b.currentCharges != null
            ? b.currentCharges
            : (b.billPrincipal || 0) - (b.openingPrincipal || 0),
        );
        const billDue = money(b.totalBillDue);
        const alreadyPaid = money(pay?.paid ?? b.amountPaid ?? 0);
        const remainingDue = money(Math.max(0, billDue - alreadyPaid));

        // systemStatus is what the DB believes right now, BEFORE the admin
        // touches anything. The grid renders it as a locked badge and the
        // verify route re-derives it independently.
        let systemStatus = "UNPAID";
        if (alreadyPaid >= billDue && billDue > 0) systemStatus = "PAID";
        else if (alreadyPaid > 0) systemStatus = "PARTIAL";

        const row = {
          billId: String(b._id),
          memberId: String(b.memberId),
          periodId,
          flat: m ? `${m.wing || ""}-${m.flatNo || ""}`.replace(/^-/, "") : "?",
          wing: m?.wing || "",
          flatNo: m?.flatNo || "",
          ownerName: m?.ownerName || "Unknown",

          // ---- LOCKED. Read-only in the grid, signed below. -------------
          openingDue,
          currentCharges,
          billDue,
          remainingDue,
          alreadyPaid,
          systemStatus,

          // ---- Context, not signed, display only ------------------------
          paidVia: pay?.sources?.includes("MEMBER_APP")
            ? "MEMBER_APP"
            : pay?.sources?.[0] || null,
          lastPaymentMode: pay?.lastMode || null,
          lastPaymentDate: pay?.lastDate || null,
          paymentCount: pay?.count || 0,
          dueDate: b.dueDate || null,

          // ---- EDITABLE. Blank on arrival. ------------------------------
          amountPaid: null,
          mode: "",
          remarks: "",
        };

        row.sig = signRow(row, fingerprint);
        return row;
      })
      .sort(
        (a, b) =>
          String(a.wing).localeCompare(String(b.wing)) ||
          String(a.flatNo).localeCompare(String(b.flatNo), undefined, {
            numeric: true,
          }),
      );

    const payload = {
      success: true,
      periodId,
      billSeries,
      fingerprint,
      builtAt: Date.now(),
      societyName: snapshot.societyName,
      rows,
      summary: {
        total: rows.length,
        alreadyPaid: rows.filter((r) => r.systemStatus === "PAID").length,
        partial: rows.filter((r) => r.systemStatus === "PARTIAL").length,
        unpaid: rows.filter((r) => r.systemStatus === "UNPAID").length,
        outstanding: money(rows.reduce((s, r) => s + r.remainingDue, 0)),
      },
    };

    await cache.set(cacheKey, payload, 300);
    return NextResponse.json(payload);
  } catch (error) {
    console.error("collection-sheet error:", error);
    return NextResponse.json(
      { error: "Failed to build collection sheet" },
      { status: 500 },
    );
  }
}

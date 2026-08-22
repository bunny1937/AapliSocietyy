// app/api/commercial/preview-bills/route.js
//
// REWRITTEN 2026-08-07 — previews now run on SHOP records, not Members.
//
// The old version took member ids, checked `isCommercialUnit(member)` (which
// read Member.flatType), and billed the flat's carpet area. That is exactly how
// A-103 produced a "commercial" preview of Rs 3,476.88 built out of its
// residential 560 sq ft and its residential Rs 1,335 arrears.
//
// Now: ids are SHOP ids, the area is the shop's own area, the opening balance
// is the shop's own opening balance, and every rate/threshold comes from the
// society's CommercialSettings. A flat cannot appear in this preview at all,
// because flats are not in the Shop collection.

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import Shop from "@/models/Shop";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { authorize } from "@/lib/rbac/authorize";
import { computeBill, resolveOpeningBalances } from "@/lib/billing/generationService";
import { listActiveCommercialHeads } from "@/lib/commercial/commercialBillingHeadService";
import { getSettings } from "@/lib/commercial/commercialSettingsService";

const shopLabel = (s) => [s.wing, s.shopNo].filter(Boolean).join("-") || String(s.shopNo || "?");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const gate = await authorize(request, "commercial.admin.update");
    if (!gate.ok) return gate.response;

    const body = await request.json();
    // `memberIds` is kept as the field name so the existing wizard keeps working;
    // the values are SHOP ids. `shopIds` is accepted too for new callers.
    const ids = Array.isArray(body.shopIds) ? body.shopIds : body.memberIds;
    const { billYear, billMonth } = body;

    if (!Array.isArray(ids) || !ids.length) {
      return NextResponse.json(
        {
          error: "Select at least one shop or office to preview.",
          code: "NO_MEMBERS",
          hint: "Tick the units you want to bill in the list above, then press Preview again.",
        },
        { status: 400 },
      );
    }
    if (!billYear || !billMonth) {
      return NextResponse.json(
        {
          error: "Choose the bill month before previewing.",
          code: "NO_PERIOD",
          hint: "Pick the month and year at the top of the page.",
        },
        { status: 400 },
      );
    }

    const societyId = decoded.societyId;
    const currentPeriodId = `${billYear}-${String(billMonth).padStart(2, "0")}`;

    const [shops, society, heads, settings] = await Promise.all([
      Shop.find({ _id: { $in: ids }, societyId, isDeleted: { $ne: true } }).lean(),
      Society.findById(societyId).lean(),
      listActiveCommercialHeads(societyId),
      getSettings({ societyId }),
    ]);

    if (!heads.length) {
      return NextResponse.json(
        {
          error: "No commercial charges have been set up yet.",
          code: "RATE_CARD_EMPTY",
          hint: "Open the shop & office rate card and add your charges (or use the standard set), then come back and preview.",
          action: { label: "Open rate card", href: "/admin/commercial/rate-card" },
        },
        { status: 409 },
      );
    }

    const skipped = [];

    if (!shops.length) {
      return NextResponse.json(
        {
          error: "None of the selected units could be found as shops.",
          code: "NO_COMMERCIAL_UNITS",
          hint: "Commercial bills are generated from the Shops list. Add the shop there first \u2014 this does not change any flat.",
          action: { label: "Open shops", href: "/admin/commercial/shops" },
          skipped,
        },
        { status: 409 },
      );
    }

    const previews = {};

    for (const shop of shops) {
      const shopId = String(shop._id);
      const label = shopLabel(shop);

      if (shop.isBillable === false || shop.isActive === false) {
        skipped.push({
          memberId: shopId,
          shopId,
          flat: label,
          memberName: shop.ownerName || "Unknown",
          code: "NOT_BILLABLE",
          reason: `${label} is switched off for billing.`,
          fix: "Open the shop and tick 'Generate bills for this unit' if it should be billed.",
          fixHref: "/admin/commercial/shops",
        });
        continue;
      }

      let computed;
      let openingPrincipal = 0;
      let openingInterest = 0;

      try {
        ({ openingPrincipal, openingInterest } = await resolveOpeningBalances({
          memberId: shopId,
          societyId,
          year: Number(billYear),
          month: Number(billMonth),
          member: shop,
          billClass: "COMMERCIAL",
        }));

        computed = computeBill({
          member: shop, // the shop IS the billable unit on this path
          heads,
          society,
          year: Number(billYear),
          month: Number(billMonth),
          openingPrincipal,
          openingInterest,
          billClass: "COMMERCIAL",
          commercialSettings: settings,
          meterUnits: Number(shop.lastMeterReading) || 0,
        });
      } catch (err) {
        // One misconfigured shop must never blank the whole preview.
        skipped.push({
          memberId: shopId,
          shopId,
          flat: label,
          memberName: shop.ownerName || "Unknown",
          code: err?.code || "CALC_FAILED",
          reason: err?.message || "This unit's bill could not be worked out.",
          fix:
            err?.details?.fix ||
            "Check the rate card amounts and this shop's area, then preview again.",
          fixHref: err?.details?.fixHref || "/admin/commercial/rate-card",
        });
        continue;
      }

      const [unpaidBills, recentTransactions] = await Promise.all([
        Bill.find({
          shopId,
          societyId,
          billSeries: "COMMERCIAL",
          status: { $in: ["Unpaid", "Overdue", "Partial"] },
          billPeriodId: { $ne: currentPeriodId },
          isDeleted: { $ne: true },
        })
          .sort({ billYear: 1, billMonth: 1 })
          .select("billPeriodId totalAmount balanceAmount dueDate status billNo")
          .lean(),
        Transaction.find({
          shopId,
          societyId,
          isReversed: false,
          billSeries: "COMMERCIAL",
        })
          .sort({ date: -1 })
          .limit(10)
          .select("date type category description amount balanceAfterTransaction billPeriodId")
          .lean(),
      ]);

      previews[shopId] = {
        memberId: shopId, // wizard compatibility
        shopId,
        flat: label,
        unitLabel: `${shop.unitKind} ${label}`,
        memberName: shop.ownerName || "Unknown",
        area: Number(shop.areaSqft) || 0,
        areaBasis: shop.areaBasisNote || "Carpet",
        unitClass: shop.unitKind,
        charges: Object.entries(computed.charges).map(([name, amount]) => ({ name, amount })),
        lines: computed.lines ?? [],
        warnings: computed.warnings ?? [],
        // Charges on the rate card that this unit is NOT billed, each with the
        // reason. Shown in the preview so "why is signage missing?" is answered
        // on the screen instead of in a support call.
        notCharged: (computed.skipped ?? []).map((sk) => ({
          name: sk.headName,
          code: sk.code || sk.reason,
          reason: sk.message || "Left off this bill.",
        })),
        openingPrincipal,
        openingInterest,
        currentCharges: computed.currentCharges,
        currentInterest: computed.currentInterest,
        interestRateApplied: computed.interestRateApplied,
        totalBillDue: computed.totalBillDue,
        unpaidBills,
        recentTransactions,
      };
    }

    return NextResponse.json({
      success: true,
      billSeries: "COMMERCIAL",
      periodId: currentPeriodId,
      previews,
      skipped,
      settingsSummary: {
        interest: settings.interest?.enabled
          ? `${settings.interest.annualRatePercent}% p.a.`
          : "No interest",
        gst: settings.gst?.mode === "None" ? "No GST" : `GST ${settings.gst?.ratePercent}%`,
        nonOccupancy: settings.nonOccupancy?.enabled ? "On (rented units)" : "Off",
      },
    });
  } catch (error) {
    console.error("commercial preview-bills error:", error);
    return NextResponse.json(
      {
        error: "The preview could not be built.",
        code: "PREVIEW_FAILED",
        hint: "Try again. If it keeps failing, check the Rate Card has at least one active charge and that your shops have areas.",
      },
      { status: 500 },
    );
  }
}

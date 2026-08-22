// lib/commercial/commercialReadiness.js
//
// REWRITTEN 2026-08-07 (v6).
//
// WHY: this file was the last place in the commercial module that still
// answered the question "what are my shops?" by reading
//
//     Member.find({ flatType: { $in: ["Shop", "Office"] } })
//
// That is the exact assumption the whole v6 rebuild removes. Shops are their
// own records now. Left as it was, the readiness strip above Generate Bills
// would have reported "0 shops" no matter how many shops you added, and would
// have kept telling you to go and re-label flats -- the very action that broke
// A-103 in the first place.
//
// Every message below is written for a non-technical society admin: what is
// wrong, why it matters to the bill, and the exact page to fix it on.

import Bill from "@/models/Bill";
import Shop from "@/models/Shop";
import {
  listActiveCommercialHeads,
  listCommercialHeadsForAdmin,
} from "./commercialBillingHeadService";
import { rateForClass } from "./commercialChargeEngine";
import { getSettings } from "./commercialSettingsService";
import { unitClassForMember } from "./constants";

const SEVERITY = { BLOCKER: "blocker", WARNING: "warning" };

const labelOf = (s) =>
  `${s.wing ? s.wing + "-" : ""}${s.shopNo || "?"}`;

/**
 * @returns {{
 *   ready: boolean,
 *   canPreview: boolean,
 *   counts: object,
 *   issues: Array<{severity,code,title,detail,fix,fixHref,affected?}>
 * }}
 */
export async function getCommercialReadiness({ societyId, periodId, flags = {} }) {
  const issues = [];

  const [allShops, heads, allHeads, settings] = await Promise.all([
    Shop.find({ societyId, isDeleted: { $ne: true } })
      .select(
        "wing shopNo unitKind ownerName areaSqft isBillable isActive occupancyType tenantName tradeName categoryId electricityMode lastMeterReading chargeOptIns",
      )
      .lean(),
    listActiveCommercialHeads(societyId),
    listCommercialHeadsForAdmin(societyId),
    getSettings({ societyId }),
  ]);

  // "Units we would actually bill" -- switched-off shops are deliberately not
  // counted as problems, because switching one off is a decision, not a fault.
  const billable = allShops.filter((s) => s.isActive !== false && s.isBillable !== false);
  const switchedOff = allShops.length - billable.length;

  const shopCount = billable.filter((s) => s.unitKind === "Shop").length;
  const officeCount = billable.filter((s) => s.unitKind === "Office").length;
  const rentedOut = billable.filter((s) => s.occupancyType === "Rented out").length;

  let billsThisPeriod = 0;
  let residentialBillsThisPeriod = 0;
  if (periodId) {
    [billsThisPeriod, residentialBillsThisPeriod] = await Promise.all([
      Bill.countDocuments({
        societyId,
        billPeriodId: periodId,
        billSeries: "COMMERCIAL",
        isDeleted: { $ne: true },
      }),
      Bill.countDocuments({
        societyId,
        billPeriodId: periodId,
        billSeries: { $ne: "COMMERCIAL" },
        isDeleted: { $ne: true },
      }),
    ]);
  }

  // ---- 1. Module / billing switch --------------------------------------
  if (flags.enabled === false) {
    issues.push({
      severity: SEVERITY.BLOCKER,
      code: "MODULE_OFF",
      title: "The commercial module is switched off",
      detail: "Shops and offices cannot be billed separately until the module is on.",
      fix: "Open Society Config and turn on 'Commercial / shops'.",
      fixHref: "/admin/society-config",
    });
  } else if (flags.commercialBillingEnabled !== true) {
    issues.push({
      severity: SEVERITY.BLOCKER,
      code: "BILLING_OFF",
      title: "Commercial billing is switched off",
      detail:
        "Your rate card is saved, but the commercial run is disabled, so shops would not be billed at all.",
      fix: "Open Society Config and tick 'Charge shops and offices differently'.",
      fixHref: "/admin/society-config",
    });
  }

  // ---- 2. Are there any shops at all? ----------------------------------
  if (allShops.length === 0) {
    issues.push({
      severity: SEVERITY.BLOCKER,
      code: "NO_COMMERCIAL_UNITS",
      title: "No shops or offices have been added yet",
      detail:
        "Shops are their own records now, kept separately from your flats. There are none on file, so a commercial run would bill nobody.",
      fix: "Open the Shops screen and add each shop. Adding a shop never changes a flat.",
      fixHref: "/admin/commercial/shops",
    });
  } else if (billable.length === 0) {
    issues.push({
      severity: SEVERITY.BLOCKER,
      code: "NO_COMMERCIAL_UNITS",
      title: `All ${allShops.length} shop(s) are switched off`,
      detail:
        "Every shop on file is marked inactive or not billable, so the commercial run has nothing to bill.",
      fix: "Open the Shops screen and switch on the ones you want to bill.",
      fixHref: "/admin/commercial/shops",
    });
  }

  // ---- 3. Rate card completeness ---------------------------------------
  if (allHeads.length === 0) {
    issues.push({
      severity: SEVERITY.BLOCKER,
      code: "RATE_CARD_EMPTY",
      title: "The commercial rate card is empty",
      detail:
        "There are no charges to put on a shop or office bill, so every bill would come to Rs 0.",
      fix: "Open the Commercial Rate Card and click 'Use standard charges' to start from the usual Indian society heads.",
      fixHref: "/admin/commercial/rate-card",
    });
  } else if (heads.length === 0) {
    issues.push({
      severity: SEVERITY.BLOCKER,
      code: "ALL_HEADS_INACTIVE",
      title: "Every charge on the rate card is switched off",
      detail: `You have ${allHeads.length} charge(s) set up, but all of them are marked inactive, so nothing would be billed.`,
      fix: "Open the Commercial Rate Card and switch on the charges you want to bill.",
      fixHref: "/admin/commercial/rate-card",
    });
  }

  for (const scope of ["Shop", "Office"]) {
    const count = scope === "Shop" ? shopCount : officeCount;
    if (count === 0) continue;
    const scoped = heads.filter((h) => h.categoryScope?.includes(scope));
    if (scoped.length === 0) {
      issues.push({
        severity: SEVERITY.BLOCKER,
        code: `NO_HEADS_FOR_${scope.toUpperCase()}`,
        title: `You have ${count} ${scope.toLowerCase()}(s) but no ${scope.toLowerCase()} charges`,
        detail: `Every charge on the rate card applies only to the other unit type, so all ${count} ${scope.toLowerCase()} bill(s) would be Rs 0.`,
        fix: `Open the Commercial Rate Card, switch to the ${scope} tab and add at least one charge.`,
        fixHref: "/admin/commercial/rate-card",
      });
      continue;
    }
    const blank = scoped.filter((h) => rateForClass(h, scope) === null);
    if (blank.length) {
      issues.push({
        severity: SEVERITY.WARNING,
        code: `BLANK_RATES_${scope.toUpperCase()}`,
        title: `${blank.length} ${scope.toLowerCase()} charge(s) have no amount filled in`,
        detail: `These will be left off every ${scope.toLowerCase()} bill: ${blank
          .map((h) => h.headName)
          .join(", ")}.`,
        fix: `Fill in the ${scope} amount on the Commercial Rate Card, or switch the charge off if you do not bill it.`,
        fixHref: "/admin/commercial/rate-card",
        affected: blank.map((h) => h.headName),
      });
    }
  }

  // ---- 3b. Opt-in charges nobody has been ticked for --------------------
  //
  // An opt-in head (signage, garbage, common electricity) bills nothing until
  // a unit is ticked for it. Setting one up and forgetting to tick anyone looks
  // exactly like the rate card working, so say it out loud.
  const optInHeads = heads.filter((h) => h.applicability === "OptIn" || h.applicability === "Quantity");
  if (optInHeads.length && billable.length) {
    const orphaned = optInHeads.filter(
      (h) =>
        !billable.some((s) =>
          (s.chargeOptIns || []).some(
            (r) => String(r.headId) === String(h.id ?? h._id) && r.enabled === true,
          ),
        ),
    );
    if (orphaned.length) {
      issues.push({
        severity: SEVERITY.WARNING,
        code: "OPT_IN_HEADS_UNASSIGNED",
        title: `${orphaned.length} charge(s) are set up but no unit is ticked for them`,
        detail: `These are only billed to units that opt in, and no unit has been ticked yet, so they will not appear on any bill: ${orphaned
          .map((h) => h.headName)
          .join(", ")}.`,
        fix: "Open each unit's Charges section and tick the ones that genuinely apply, or switch the charge off on the rate card.",
        fixHref: "/admin/commercial/shops",
        affected: orphaned.map((h) => h.headName),
      });
    }
  }

  // ---- 4. Area -- a shop cannot be billed without its own area ----------
  //
  // Note this checks Shop.areaSqft, NOT a flat's carpet area. A shop with no
  // area is a blocker regardless of the rate card, because the funds and the
  // per-sq-ft heads both collapse to zero.
  const noArea = billable.filter((s) => !(Number(s.areaSqft) > 0));
  if (noArea.length) {
    const usesPerSqft =
      heads.some((h) => h.calculationType === "Per Sq Ft") ||
      settings?.funds?.sinking?.method === "PerSqFt" ||
      settings?.funds?.repair?.method === "PerSqFt";
    issues.push({
      severity: usesPerSqft ? SEVERITY.BLOCKER : SEVERITY.WARNING,
      code: "AREA_MISSING",
      title: `${noArea.length} shop(s) have no area recorded`,
      detail:
        "A shop has its own area, separate from any flat. Without it these units would be billed Rs 0 for every per-sq-ft charge: " +
        noArea.map(labelOf).join(", ") +
        ".",
      fix: "Open the Shops screen and fill in the Area (sq ft) for these units.",
      fixHref: "/admin/commercial/shops",
      affected: noArea.map((s) => String(s._id)),
    });
  }

  // ---- 5. Non-occupancy needs at least one service-charge head ---------
  const nonOccApplies =
    settings?.nonOccupancy?.enabled === true &&
    ["Commercial", "Both"].includes(settings?.nonOccupancy?.appliesTo);
  if (nonOccApplies && rentedOut > 0 && !heads.some((h) => h.isServiceCharge)) {
    issues.push({
      severity: SEVERITY.WARNING,
      code: "NO_SERVICE_CHARGE_HEAD",
      title: `${rentedOut} shop(s) are rented out, but no charge counts as a service charge`,
      detail:
        "Non-occupancy charges are capped at 10% of service charges. With no head ticked as a service charge, no non-occupancy charge can be raised.",
      fix: "On the Commercial Rate Card, tick 'Service charge' on Maintenance, Water, Security and similar heads.",
      fixHref: "/admin/commercial/rate-card",
    });
  }

  // ---- 6. The rules the admin chose, enforced here too -----------------
  if (settings?.requireBusinessProfileBeforeBilling) {
    const noTrade = billable.filter((s) => !s.tradeName && !s.categoryId);
    if (noTrade.length) {
      issues.push({
        severity: SEVERITY.BLOCKER,
        code: "PROFILE_REQUIRED",
        title: `${noTrade.length} shop(s) have no business details`,
        detail:
          "You switched on 'Require the business details before generating a shop bill' on the rate card's Rules tab, so these will be skipped: " +
          noTrade.map(labelOf).join(", ") +
          ".",
        fix: "Either add the trade name and category on the Shops screen, or turn that rule off under Rate card, Rules and tax.",
        fixHref: "/admin/commercial/shops",
        affected: noTrade.map((s) => String(s._id)),
      });
    }
  }

  if (settings?.electricity?.societyManagedEnabled && settings?.electricity?.requireMeterReading) {
    const noReading = billable.filter(
      (s) =>
        s.electricityMode === "Society-managed sub-meter" &&
        !(Number(s.lastMeterReading) >= 0),
    );
    if (noReading.length) {
      issues.push({
        severity: SEVERITY.WARNING,
        code: "METER_READING_MISSING",
        title: `${noReading.length} sub-metered shop(s) have no meter reading`,
        detail:
          "These shops are set to society-managed electricity but have no reading this period, so no electricity line can be raised for them: " +
          noReading.map(labelOf).join(", ") +
          ".",
        fix: "Enter this period's reading on the Shops screen before generating.",
        fixHref: "/admin/commercial/shops",
        affected: noReading.map((s) => String(s._id)),
      });
    }
  }

  const blockers = issues.filter((i) => i.severity === SEVERITY.BLOCKER);

  return {
    ready: blockers.length === 0,
    canPreview: billable.length > 0 && heads.length > 0,
    counts: {
      units: billable.length,
      shops: shopCount,
      offices: officeCount,
      switchedOff,
      activeHeads: heads.length,
      totalHeads: allHeads.length,
      rentedOut,
      billsThisPeriod,
      residentialBillsThisPeriod,
    },
    issues,
  };
}

/**
 * Kept for callers that still hand us Member-shaped rows. Nothing in the
 * commercial billing path uses it any more -- the commercial run reads Shops.
 */
export function partitionMembersByClass(members) {
  const commercial = [];
  const residential = [];
  for (const m of members) {
    if (unitClassForMember(m) === "Residential") residential.push(m);
    else commercial.push(m);
  }
  return { commercial, residential };
}

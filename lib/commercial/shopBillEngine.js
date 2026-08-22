// lib/commercial/shopBillEngine.js
//
// NEW 2026-08-07. Calculates a commercial bill for a SHOP record using the
// society's own CommercialSettings.
//
// Everything this file applies used to be a hardcoded constant somewhere:
//   - 21% interest              -> settings.interest.annualRatePercent
//   - 10% non-occupancy cap     -> settings.nonOccupancy.*
//   - Rs 7,500 GST threshold    -> settings.gst.*
//   - sinking 0.25 / repair 0.75-> settings.funds.*
//   - "profile required"        -> settings.requireBusinessProfileBeforeBilling
//   - electricity              -> settings.electricity + shop.electricityMode
//
// It is a separate file from commercialChargeEngine.js on purpose: that engine
// still serves the legacy Member-based path, and a shop bill must not be able
// to regress it.

import { CALC_TYPES, rateForClass, CommercialBillingError } from "./commercialChargeEngine";
import { toBillableUnit } from "./shopAdapter";
import { computeGst } from "./commercialSettingsService";
import { selectHeadsForShop } from "./shopChargeApplicability";

const twoDp = (n) => Math.round((Number(n) || 0) * 100) / 100;

function orderHeads(heads) {
  const phase = (h) => (h.calculationType === CALC_TYPES.PERCENTAGE ? 1 : 0);
  return [...heads].sort(
    (a, b) =>
      phase(a) - phase(b) ||
      Number(a.sortOrder ?? 500) - Number(b.sortOrder ?? 500) ||
      String(a.headName || "").localeCompare(String(b.headName || "")),
  );
}

/**
 * @param {object} shop      a Shop document (models/Shop.js)
 * @param {Array}  heads     rows from listActiveCommercialHeads()
 * @param {object} settings  from getSettings()
 * @param {{ strict?: boolean, hasTradeDetails?: boolean }} opts
 *        strict = throw instead of warn (generation). Preview passes false so
 *        the admin can SEE every problem at once instead of one at a time.
 */
export function calculateShopBill(shop, heads, settings, opts = {}) {
  const strict = opts.strict === true;
  const unit = toBillableUnit(shop);
  const warnings = [];
  const skipped = [];

  // ---- Gate: trade details, only if the society switched it on (Q16) ----
  if (settings?.requireBusinessProfileBeforeBilling) {
    const hasDetails =
      opts.hasTradeDetails ?? !!(shop?.tradeName && shop?.categoryId);
    if (!hasDetails) {
      const msg = `${unit.label} has no business name or category filled in, and this society requires them before billing.`;
      if (strict) {
        throw new CommercialBillingError("PROFILE_REQUIRED", msg, { shopId: unit.id });
      }
      warnings.push({
        code: "PROFILE_REQUIRED",
        message: msg,
        fix: "Add the business name and category on the Shops screen, or switch this requirement off on the Rate Card.",
      });
    }
  }

  const area = unit.area;
  const unitClass = unit.unitClass; // "Shop" | "Office"

  const active = (heads || []).filter(
    (h) =>
      h &&
      h.isActive !== false &&
      Array.isArray(h.categoryScope) &&
      h.categoryScope.includes(unitClass),
  );

  if (active.length === 0) {
    throw new CommercialBillingError(
      "NO_ACTIVE_HEADS",
      `No active ${unitClass} charges exist on the Commercial Rate Card, so this bill would be Rs 0. Add at least one charge there first.`,
      { unitClass },
    );
  }

  // Per-unit applicability, applied AFTER the "is the rate card empty?" check
  // above so a shop that simply opted out of everything gets an accurate
  // explanation instead of "your rate card is empty".
  const { heads: selected, skipped: notApplicable } = selectHeadsForShop(
    active,
    shop,
    unitClass,
  );
  skipped.push(...notApplicable);
  // Heads arrive as DTOs from listActiveCommercialHeads() (string `id`, no
  // `_id`), so key on whichever identity the row actually carries.
  const headKey = (h) => String(h._id ?? h.id ?? h.headName);
  const quantityByHead = new Map(
    selected.map(({ head, quantity }) => [headKey(head), quantity]),
  );
  const quantityFor = (head) => quantityByHead.get(headKey(head)) ?? 1;

  const ordered = orderHeads(selected.map(({ head }) => head));
  const breakdown = {};
  const lines = [];
  let baseSubtotal = 0;
  let serviceChargeTotal = 0;

  // ---- Pass 1: Fixed and Per Sq Ft --------------------------------------
  for (const head of ordered) {
    if (head.calculationType === CALC_TYPES.PERCENTAGE) continue;

    // Quantity heads (e.g. reserved parking) bill rate x slots allotted; every
    // other head is a single unit.
    const qty = quantityFor(head);
    const rate = rateForClass(head, unitClass);
    if (rate === null) {
      const msg = `"${head.headName}" has no ${unitClass} amount on the rate card, so it was left off this bill.`;
      if (strict) throw new CommercialBillingError("RATE_NOT_SET", msg, { headName: head.headName });
      skipped.push({ headName: head.headName, reason: "RATE_NOT_SET", message: msg });
      continue;
    }

    let amount;
    let calculation;
    if (head.calculationType === CALC_TYPES.PER_SQFT) {
      if (area <= 0) {
        const msg = `"${head.headName}" is charged per sq ft but ${unit.label} has no area recorded, so it was left off this bill.`;
        if (strict) throw new CommercialBillingError("AREA_MISSING", msg, { headName: head.headName });
        skipped.push({ headName: head.headName, reason: "AREA_MISSING", message: msg });
        continue;
      }
      amount = twoDp(area * rate * qty);
      calculation =
        qty === 1
          ? `${area} sq ft x Rs ${rate}/sq ft`
          : `${area} sq ft x Rs ${rate}/sq ft x ${qty}`;
    } else {
      amount = twoDp(rate * qty);
      calculation =
        qty === 1 ? "Flat monthly amount" : `Rs ${rate} x ${qty}`;
    }

    breakdown[head.headName] = amount;
    lines.push({
      headName: head.headName,
      calculationType: head.calculationType,
      rate,
      amount,
      calculation,
      isServiceCharge: !!head.isServiceCharge,
    });
    baseSubtotal = twoDp(baseSubtotal + amount);
    if (head.isServiceCharge) serviceChargeTotal = twoDp(serviceChargeTotal + amount);
  }

  // ---- Pass 2: Percentage heads, all on the SAME stable base -------------
  for (const head of ordered) {
    if (head.calculationType !== CALC_TYPES.PERCENTAGE) continue;
    const pct = rateForClass(head, unitClass);
    if (pct === null) {
      const msg = `"${head.headName}" has no ${unitClass} percentage on the rate card, so it was left off this bill.`;
      if (strict) throw new CommercialBillingError("RATE_NOT_SET", msg, { headName: head.headName });
      skipped.push({ headName: head.headName, reason: "RATE_NOT_SET", message: msg });
      continue;
    }
    if (baseSubtotal <= 0) {
      warnings.push({
        code: "PERCENTAGE_WITHOUT_BASE",
        message: `"${head.headName}" is a percentage charge but there is no fixed or per-sq-ft charge for it to apply to, so it came to Rs 0.`,
      });
    }
    const amount = twoDp(baseSubtotal * (pct / 100));
    breakdown[head.headName] = amount;
    lines.push({
      headName: head.headName,
      calculationType: head.calculationType,
      rate: pct,
      amount,
      calculation: `${pct}% of Rs ${baseSubtotal.toFixed(2)}`,
      isServiceCharge: !!head.isServiceCharge,
    });
  }

  let subtotal = twoDp(
    Object.values(breakdown).reduce((a, b) => a + b, 0),
  );

  // ---- Sinking + repair funds, from settings (Q14) -----------------------
  const fundLine = (key, label) => {
    const f = settings?.funds?.[key];
    if (!f?.enabled) return;
    const value = Number(f.value) || 0;
    if (value <= 0) return;

    let amount = 0;
    let calculation = "";
    if (f.method === "PerSqFt") {
      if (area <= 0) {
        warnings.push({
          code: "FUND_NEEDS_AREA",
          message: `${label} is set per sq ft but ${unit.label} has no area, so it came to Rs 0.`,
        });
        return;
      }
      amount = twoDp(area * value);
      calculation = `${area} sq ft x Rs ${value}/sq ft`;
    } else if (f.method === "Percent") {
      amount = twoDp(baseSubtotal * (value / 100));
      calculation = `${value}% of Rs ${baseSubtotal.toFixed(2)}`;
    } else {
      amount = twoDp(value);
      calculation = "Flat monthly amount";
    }
    if (amount <= 0) return;
    breakdown[label] = amount;
    lines.push({
      headName: label,
      calculationType: f.method,
      rate: value,
      amount,
      calculation,
      isServiceCharge: false,
      source: "settings",
    });
    subtotal = twoDp(subtotal + amount);
  };
  fundLine("sinking", "Sinking Fund");
  fundLine("repair", "Repair Fund");

  // ---- Electricity (Q13) -------------------------------------------------
  // Default is that the shop pays its own bill, so the society charges nothing.
  let electricity = { charged: false, amount: 0, reason: "This shop pays its own electricity bill directly." };
  if (shop?.electricityMode === "Society-managed sub-meter") {
    if (!settings?.electricity?.societyManagedEnabled) {
      warnings.push({
        code: "ELECTRICITY_NOT_ENABLED",
        message: `${unit.label} is set to society-managed electricity, but that feature is switched off on the Rate Card, so nothing was charged.`,
        fix: "Switch on society-managed electricity on the Rate Card, or set this shop back to its own connection.",
      });
    } else {
      const fixed = Number(settings.electricity.fixedMonthlyCharge) || 0;
      const perUnit = Number(settings.electricity.ratePerUnit) || 0;
      const units = Number(opts.meterUnits) || 0;

      if (settings.electricity.requireMeterReading && units <= 0) {
        const msg = `${unit.label} is on a society sub-meter but no meter reading was entered for this month.`;
        if (strict) throw new CommercialBillingError("METER_READING_MISSING", msg, { shopId: unit.id });
        warnings.push({
          code: "METER_READING_MISSING",
          message: msg,
          fix: "Enter this month's units on the Shops screen, or switch off 'require meter reading' on the Rate Card.",
        });
      }

      const amount = twoDp(fixed + units * perUnit);
      if (amount > 0) {
        breakdown["Electricity (sub-meter)"] = amount;
        lines.push({
          headName: "Electricity (sub-meter)",
          calculationType: "Metered",
          rate: perUnit,
          amount,
          calculation:
            units > 0
              ? `${units} units x Rs ${perUnit}` + (fixed ? ` + Rs ${fixed} fixed` : "")
              : `Rs ${fixed} fixed`,
          isServiceCharge: true,
          source: "settings",
        });
        subtotal = twoDp(subtotal + amount);
        serviceChargeTotal = twoDp(serviceChargeTotal + amount);
        electricity = { charged: true, amount, reason: `Society-managed sub-meter recovery.` };
      }
    }
  }

  // ---- Non-occupancy, from settings (Q15) --------------------------------
  let nonOccupancy = { charged: false, amount: 0, reason: "" };
  const noSet = settings?.nonOccupancy;
  const appliesHere =
    noSet?.enabled && (noSet.appliesTo === "Both" || noSet.appliesTo === "Commercial");

  if (appliesHere && unit.isRentedOut) {
    const method = noSet.commercial?.method ?? "Percent";
    const value = Number(noSet.commercial?.value) || 0;
    let amount =
      method === "Percent" ? twoDp(serviceChargeTotal * (value / 100)) : twoDp(value);

    // Bombay HC Mar 2007 / Maharashtra GR Aug 2001: never more than the
    // configured cap of service charges, whatever was typed in.
    const capPct = Number(noSet.commercial?.capPercentOfServiceCharges ?? 10);
    const cap = twoDp(serviceChargeTotal * (capPct / 100));
    let capped = false;
    if (cap > 0 && amount > cap) {
      amount = cap;
      capped = true;
    }

    if (serviceChargeTotal <= 0) {
      warnings.push({
        code: "NON_OCCUPANCY_NO_SERVICE_CHARGE",
        message:
          "Non-occupancy is switched on but no charge on the rate card is marked as a service charge, so it came to Rs 0.",
        fix: "Tick 'service charge' on the relevant heads on the Rate Card.",
      });
    } else if (amount > 0) {
      breakdown["Non-Occupancy Charge"] = amount;
      lines.push({
        headName: "Non-Occupancy Charge",
        calculationType: method,
        rate: value,
        amount,
        calculation: capped
          ? `Capped at ${capPct}% of service charges (Rs ${serviceChargeTotal.toFixed(2)})`
          : method === "Percent"
            ? `${value}% of service charges (Rs ${serviceChargeTotal.toFixed(2)})`
            : "Flat monthly amount",
        isServiceCharge: false,
        source: "settings",
      });
      subtotal = twoDp(subtotal + amount);
      nonOccupancy = {
        charged: true,
        amount,
        reason: capped
          ? `Rented out. Capped at the lawful ${capPct}% of service charges.`
          : "Rented out.",
      };
    }
  } else if (noSet?.enabled && !unit.isRentedOut) {
    nonOccupancy.reason = "Owner-occupied, so no non-occupancy charge.";
  }

  // ---- GST, from settings (Q7) -------------------------------------------
  const gst = computeGst({ settings, subtotal, serviceChargeTotal });
  if (gst.applicable && gst.amount > 0) {
    breakdown["GST"] = gst.amount;
    lines.push({
      headName: "GST",
      calculationType: "Percentage",
      rate: settings?.gst?.ratePercent ?? 0,
      amount: gst.amount,
      calculation: gst.reason,
      isServiceCharge: false,
      source: "settings",
    });
    subtotal = twoDp(subtotal + gst.amount);
  }

  return {
    breakdown,
    subtotal,
    lines,
    meta: {
      unitClass,
      unitLabel: unit.label,
      area,
      areaLabel: unit.areaLabel,
      baseSubtotal,
      serviceChargeTotal,
      nonOccupancy,
      electricity,
      gst,
      warnings,
      skipped,
    },
  };
}

import { toBillableUnit } from "./shopAdapter";
import { computeGst } from "./commercialSettingsService";
import { selectHeadsForShop } from "./shopChargeApplicability";

const LEGAL_NON_OCCUPANCY_CAP_PERCENT = 10; // Bombay HC Mar 2007 / Maharashtra
// GR Aug 2001 — non-occupancy charge <= 10% of service charges, never higher,
// regardless of what a society's own settings say. Applied as a hard ceiling
// even when Rules & tax sets capPercentOfServiceCharges above this.

const round2 = (n) => parseFloat((Number(n) || 0).toFixed(2));

// null means "no amount filled in yet" (unconfigured); 0 means the admin
// deliberately charges nothing. Both readiness and the engine below tell those
// apart: an unconfigured head is skipped with a reason, a deliberate 0 bills 0.
export function rateForClass(head, unitClass) {
  const v = head?.rate?.[unitClass];
  return v === null || v === undefined ? null : Number(v);
}

// `member` is really "whatever the caller is billing" — a Shop record on the
// live path, or (legacy) a Member. toBillableUnit() is the one place that
// tells the two apart, so this never again reads `flatType` off a Shop (which
// doesn't have one) and silently falls back to "Residential".
//
// `opts.settings` is the society's CommercialSettings (getSettings()) —
// without it, GST/funds/electricity/non-occupancy all fall back to "off",
// same as before this was wired in. `opts.meterUnits` is the shop's own
// electricity-meter reading for this period (see caller for the caveat: this
// is the raw reading, not a reading-to-reading delta — a real sub-meter
// consumption history is not modelled yet).
export function calculateCommercialCharges(member, commercialHeads, opts = {}) {
  const nonOccupancyCharged = opts.nonOccupancyCharged === true;
  const settings = opts.settings || null;
  const meterUnits = Number(opts.meterUnits) || 0;
  const unit = toBillableUnit(member);
  const unitClass = unit.unitClass; // "Shop" | "Office" | "Residential"
  const area = unit.area;

  // Class scope AND per-unit applicability. `member` is the Shop record on the
  // live path, so its chargeOptIns decide the opt-in and quantity heads; a
  // legacy Member has none and therefore only ever gets "All" heads.
  const { heads: applicable, skipped: notApplicable } = selectHeadsForShop(
    commercialHeads,
    member,
    unitClass,
  );

  const breakdown = {};
  const skipped = [...notApplicable];
  let serviceChargeTotal = 0;
  let runningBase = 0;
  for (const { head, quantity } of applicable) {
    const rate = rateForClass(head, unitClass);
    // null = the admin never filled an amount in for this class. Charging Rs 0
    // still printed the head on the bill and hid the misconfiguration, so skip
    // it and say why instead.
    if (rate === null) {
      skipped.push({
        headName: head.headName,
        reason: "RATE_NOT_SET",
        code: "RATE_NOT_SET",
        message: `"${head.headName}" has no ${unitClass} amount on the rate card, so it was left off this bill.`,
      });
      continue;
    }
    let amount = 0;
    if (head.calculationType === "Per Sq Ft") amount = area * rate * quantity;
    else if (head.calculationType === "Percentage") amount = runningBase * (rate / 100);
    else amount = rate * quantity; // Fixed

    amount = round2(amount);
    breakdown[head.headName] = amount;
    runningBase += amount;
    if (head.isServiceCharge) serviceChargeTotal += amount;
  }

  // ---- Funds (sinking / repair) — Rules & tax tab, not rate-card heads ----
  // Same shape as residential's funds: a rate the society enters once, applied
  // every bill. Never counted as a service charge (matches the preset heads,
  // which ship isServiceCharge: false for these two).
  for (const [label, fund] of [
    ["Sinking Fund", settings?.funds?.sinking],
    ["Repair & Maintenance Fund", settings?.funds?.repair],
  ]) {
    if (!fund?.enabled) continue;
    const value = Number(fund.value) || 0;
    let amount = 0;
    if (fund.method === "PerSqFt") amount = area * value;
    else if (fund.method === "Percent") amount = runningBase * (value / 100);
    else amount = value; // Fixed
    amount = round2(amount);
    if (amount > 0) {
      breakdown[label] = amount;
      runningBase += amount;
    }
  }

  // ---- Electricity (society-managed sub-meter) ----------------------------
  // Only for shops on their OWN "Society-managed sub-meter" setting — a shop
  // paying its own connection directly is never billed this line, whatever
  // the society-wide switch says.
  if (settings?.electricity?.societyManagedEnabled && unit.kind === "shop") {
    const shopElectricityMode = member?.electricityMode;
    if (shopElectricityMode === "Society-managed sub-meter") {
      const rate = Number(settings.electricity.ratePerUnit) || 0;
      const fixed = Number(settings.electricity.fixedMonthlyCharge) || 0;
      const amount = round2(meterUnits * rate + fixed);
      if (amount > 0) {
        breakdown["Electricity (Sub-meter)"] = amount;
        runningBase += amount;
      }
    }
  }

  // ---- GST — on heads + funds + electricity, before non-occupancy --------
  const gst = settings ? computeGst({ settings, subtotal: runningBase, serviceChargeTotal }) : null;
  if (gst?.applicable && gst.amount > 0) {
    breakdown["GST"] = round2(gst.amount);
    runningBase += breakdown["GST"];
  }

  // ---- Non-occupancy — capped at the LEGAL 10% of service charges, even if
  //      the society's own setting is higher. Society setting can only be
  //      more conservative than the law, never less.
  if (nonOccupancyCharged && serviceChargeTotal > 0) {
    const noc = settings?.nonOccupancy?.commercial || { method: "Percent", value: 10 };
    const cap = serviceChargeTotal * (LEGAL_NON_OCCUPANCY_CAP_PERCENT / 100);
    const raw =
      noc.method === "Rupees"
        ? Number(noc.value) || 0
        : serviceChargeTotal * ((Number(noc.value) || 0) / 100);
    const amount = round2(Math.min(raw, cap));
    if (amount > 0) breakdown["Non-Occupancy Charge"] = amount;
  }

  const subtotal = round2(Object.values(breakdown).reduce((s, v) => s + v, 0));
  // `skipped` is additive: callers that ignore it behave exactly as before,
  // callers that show it can tell the admin WHY a head is missing instead of
  // leaving them to compare the bill against the rate card by eye.
  return { breakdown, subtotal, skipped };
}

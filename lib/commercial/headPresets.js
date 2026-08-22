
// lib/commercial/headPresets.js
//
// NEW FILE.
//
// The old rate card started completely empty, so the admin's first job was to
// invent the names, calculation types and rates of every commercial head from
// scratch — which is exactly why the page felt unusable.
//
// These presets are the heads a Maharashtra co-operative housing society
// actually raises on a shop/office unit (MCS Act 1960 bye-law 68 heads, plus
// the commercial-only ones societies add in practice). One click seeds them,
// the admin then only edits AMOUNTS.
//
// Nothing here is charged until the admin sets an amount: every preset ships
// with a suggested rate that the admin must confirm, and a head with no rate
// for a unit class is skipped by the engine (with a visible warning).

export const HEAD_PRESETS = [
  {
    key: "maintenance",
    applicability: "All",
    headName: "Maintenance / Service Charges",
    calculationType: "Per Sq Ft",
    suggested: { Shop: 3, Office: 3 },
    isServiceCharge: true,
    nonOccupancyEligible: true,
    sortOrder: 10,
    help: "The main monthly charge. Societies usually bill shops per sq ft at 1.5x-2x the residential rate.",
  },
  {
    key: "sinking-fund",
    applicability: "All",
    headName: "Sinking Fund",
    calculationType: "Per Sq Ft",
    suggested: { Shop: 0.5, Office: 0.5 },
    isServiceCharge: false,
    nonOccupancyEligible: false,
    sortOrder: 20,
    help: "Bye-law 13(c): minimum 0.25% p.a. of construction cost. Most societies bill it per sq ft.",
  },
  {
    key: "repair-fund",
    applicability: "All",
    headName: "Repair & Maintenance Fund",
    calculationType: "Per Sq Ft",
    suggested: { Shop: 0.75, Office: 0.75 },
    isServiceCharge: false,
    nonOccupancyEligible: false,
    sortOrder: 30,
    help: "Bye-law 13(b): minimum 0.75% p.a. of construction cost per unit.",
  },
  {
    key: "water",
    applicability: "All",
    headName: "Water Charges",
    calculationType: "Fixed",
    suggested: { Shop: 300, Office: 200 },
    isServiceCharge: true,
    nonOccupancyEligible: true,
    sortOrder: 40,
    help: "Per unit per month. Shops with a kitchen/wash area are usually charged more.",
  },
  {
    key: "electricity-common",
    applicability: "OptIn",
    headName: "Common Electricity",
    calculationType: "Fixed",
    suggested: { Shop: 250, Office: 250 },
    isServiceCharge: true,
    nonOccupancyEligible: true,
    sortOrder: 50,
    help: "Passage, signage and pump lighting. Not the shop's own meter.",
  },
  {
    key: "security",
    applicability: "All",
    headName: "Security Charges",
    calculationType: "Fixed",
    suggested: { Shop: 400, Office: 400 },
    isServiceCharge: true,
    nonOccupancyEligible: true,
    sortOrder: 60,
    help: "Equal per unit — bye-laws require security to be split equally, not by area.",
  },
  {
    key: "housekeeping",
    applicability: "OptIn",
    headName: "Housekeeping & Garbage",
    calculationType: "Fixed",
    suggested: { Shop: 300, Office: 200 },
    isServiceCharge: true,
    nonOccupancyEligible: true,
    sortOrder: 70,
    help: "Commercial units generate more waste; most societies bill shops a higher flat rate.",
  },
  {
    key: "signage",
    applicability: "OptIn",
    headName: "Signage / Hoarding Charges",
    calculationType: "Fixed",
    suggested: { Shop: 500, Office: 0 },
    isServiceCharge: false,
    nonOccupancyEligible: false,
    sortOrder: 80,
    help: "Commercial-only. Charged when the shop displays a board on the society facade.",
  },
  {
    key: "parking",
    applicability: "Quantity",
    quantityLabel: "reserved parking slots",
    headName: "Commercial Parking",
    calculationType: "Fixed",
    suggested: { Shop: 500, Office: 500 },
    isServiceCharge: false,
    nonOccupancyEligible: false,
    sortOrder: 90,
    help: "Per allotted slot. Leave blank if the shop has no reserved slot.",
  },
  {
    key: "lift",
    applicability: "All",
    headName: "Lift Maintenance",
    calculationType: "Fixed",
    suggested: { Shop: 0, Office: 300 },
    isServiceCharge: true,
    nonOccupancyEligible: true,
    sortOrder: 100,
    help: "Ground-floor shops normally do not use the lift — leave the Shop amount blank.",
  },
];

export const PRESET_BY_KEY = Object.fromEntries(HEAD_PRESETS.map((p) => [p.key, p]));

/**
 * Build create-payloads for a starter pack, scoped to one unit class.
 * Amounts default to the suggestion so the admin sees a working bill
 * immediately and only has to correct the numbers.
 */
export function buildPresetPayloads(scope /* "Shop" | "Office" */, keys) {
  const wanted = Array.isArray(keys) && keys.length
    ? HEAD_PRESETS.filter((p) => keys.includes(p.key))
    : HEAD_PRESETS;

  return wanted
    .filter((p) => Number(p.suggested?.[scope]) > 0)
    .map((p) => ({
      headName: p.headName,
      categoryScope: [scope],
      calculationType: p.calculationType,
      rate: { [scope]: Number(p.suggested[scope]) },
      isServiceCharge: p.isServiceCharge,
      nonOccupancyEligible: p.nonOccupancyEligible,
      sortOrder: p.sortOrder,
      notes: p.help,
      // Per-unit applicability. "All" bills every unit of the class; "OptIn"
      // bills only shops that ticked it on their own record; "Quantity" bills
      // rate x the count the shop was allotted. Without this every head landed
      // on every shop — signage on shops with no board, garbage and parking on
      // shops that never asked for them.
      applicability: p.applicability || "All",
      quantityLabel: p.quantityLabel || null,
      // Stable identity for the per-shop opt-in rows, so renaming the head on
      // the rate card does not silently detach every shop's choice.
      optInKey: p.key,
    }));
}

// Charged at Rs 7,500/unit/month a society crosses the GST registration
// threshold for maintenance collected from a member (CBIC Circular 109/28/2019).
export const GST_THRESHOLD_PER_UNIT = 7500;

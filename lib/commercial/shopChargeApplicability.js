// lib/commercial/shopChargeApplicability.js
//
// The one place that answers "is this rate-card head actually billable to THIS
// shop?".
//
// Before this file existed, both commercial engines selected heads on
// `isActive && categoryScope.includes(unitClass)` alone. categoryScope is a
// CLASS scope (Shop / Office), so that test is all-or-nothing per class: every
// active head landed on every shop. Real societies charge signage only to the
// shops with a board, garbage and parking only to the ones that asked, and
// common electricity only to the ones drawing off the society's meter.
//
// Deliberately dependency-free and synchronous so the two server engines
// (commercialChargeEngine, shopBillEngine) AND the client-side rate-card
// simulator can all import it. Three copies of this decision is how preview
// and reality drifted apart in the first place.

export const APPLICABILITY = {
  ALL: "All",
  OPT_IN: "OptIn",
  QUANTITY: "Quantity",
};

// The society's common-meter recovery head. A shop on a society-managed
// sub-meter already pays for its consumption through the metered line the
// engines add separately, so billing it the common head too is a double
// charge — see the electricity blocks in both engines.
export const COMMON_ELECTRICITY_KEY = "electricity-common";

// Sinking and repair funds are billed from the society's Rules & Tax
// settings (settings.funds.sinking/repair — see commercialSettingsService.js),
// not from a rate-card head's own rate. Both server engines add these as a
// fixed-name line AFTER the head pass and OVERWRITE any head of the same
// name in the breakdown, so a "Sinking Fund"/"Repair & Maintenance Fund"
// head from lib/commercial/headPresets.js is a dead control: its rate is
// never the number that actually bills, which is exactly the "rate card
// says X, bill says Y" mismatch this constant exists to close. Excluding
// them here means they never enter a head-based total (server OR the
// rate-card preview, which shares this function) — only the one real
// settings-driven number ever gets shown or charged.
export const FUND_HEAD_NAMES = new Set(["Sinking Fund", "Repair & Maintenance Fund"]);
export const FUND_HEAD_KEYS = new Set(["sinking-fund", "repair-fund"]);

export function isFundHead(head) {
  return FUND_HEAD_KEYS.has(head?.key) || FUND_HEAD_NAMES.has(head?.headName);
}

function normaliseOptIns(shop) {
  const rows = Array.isArray(shop?.chargeOptIns) ? shop.chargeOptIns : [];
  const byHeadId = new Map();
  const byKey = new Map();
  for (const row of rows) {
    if (!row) continue;
    if (row.headId) byHeadId.set(String(row.headId), row);
    if (row.optInKey) byKey.set(String(row.optInKey), row);
  }
  return { byHeadId, byKey };
}

/** The opt-in row a shop stored for a head, matched by id first then by key. */
export function findOptIn(shop, head) {
  const { byHeadId, byKey } = normaliseOptIns(shop);
  const headId = head?._id ?? head?.id;
  if (headId && byHeadId.has(String(headId))) return byHeadId.get(String(headId));
  if (head?.optInKey && byKey.has(String(head.optInKey))) return byKey.get(String(head.optInKey));
  return null;
}

/**
 * @param head  a CommercialBillingHead (lean doc or plain object)
 * @param shop  a Shop document. Legacy Member records have no chargeOptIns and
 *              therefore behave exactly as before for "All" heads, and are
 *              never charged opt-in heads.
 * @returns {{ applies: boolean, quantity: number, reason: string|null }}
 *          `quantity` is the multiplier the caller must apply (always 1 for
 *          non-quantity heads). `reason` is a plain-English explanation of a
 *          skip, meant to be shown to the admin rather than swallowed.
 */
export function headAppliesToShop(head, shop) {
  const mode = head?.applicability || APPLICABILITY.ALL;

  // A society-managed sub-meter shop pays through the metered line instead.
  // This holds regardless of what the shop ticked, because the two together
  // are always a double charge.
  if (
    head?.optInKey === COMMON_ELECTRICITY_KEY &&
    shop?.electricityMode === "Society-managed sub-meter"
  ) {
    return {
      applies: false,
      quantity: 0,
      reason:
        "This shop is on a society-managed sub-meter, so it is billed for its own metered units instead of the common electricity head.",
    };
  }

  if (mode === APPLICABILITY.ALL) return { applies: true, quantity: 1, reason: null };

  const optIn = findOptIn(shop, head);

  if (mode === APPLICABILITY.OPT_IN) {
    if (optIn?.enabled) return { applies: true, quantity: 1, reason: null };
    return {
      applies: false,
      quantity: 0,
      reason: `"${head?.headName || "This charge"}" is only billed to units that opt in, and this one has not.`,
    };
  }

  if (mode === APPLICABILITY.QUANTITY) {
    const qty = Number(optIn?.quantity) || 0;
    if (optIn?.enabled && qty > 0) return { applies: true, quantity: qty, reason: null };
    return {
      applies: false,
      quantity: 0,
      reason: `"${head?.headName || "This charge"}" is billed per ${
        head?.quantityLabel || "unit allotted"
      }, and this unit has none recorded.`,
    };
  }

  // Unknown mode — fail closed rather than silently billing money.
  return {
    applies: false,
    quantity: 0,
    reason: `"${head?.headName || "This charge"}" has an unrecognised applicability setting (${mode}), so it was left off this bill.`,
  };
}

/**
 * Head selection shared by both engines: class scope + active + per-unit
 * applicability, in one pass, keeping the skip reasons so the caller can show
 * them instead of leaving the admin to guess.
 *
 * @returns {{ heads: Array<{head:object, quantity:number}>, skipped: Array<{headName:string, reason:string, code:string, message:string}> }}
 */
export function selectHeadsForShop(heads, shop, unitClass) {
  const selected = [];
  const skipped = [];
  for (const head of heads || []) {
    if (head?.isActive === false) continue;
    if (!Array.isArray(head?.categoryScope) || !head.categoryScope.includes(unitClass)) continue;
    if (isFundHead(head)) {
      skipped.push({
        headName: head?.headName || "",
        reason: "SET_IN_RULES_AND_TAX",
        code: "SET_IN_RULES_AND_TAX",
        message: `"${head?.headName}" is billed using the amount set under Rules & Tax, not the rate shown here.`,
      });
      continue;
    }
    const verdict = headAppliesToShop(head, shop);
    if (verdict.applies) selected.push({ head, quantity: verdict.quantity });
    else
      // Shape matches the `skipped` rows both engines already emit:
      // `reason` is the machine code, `message` the sentence shown to the admin.
      skipped.push({
        headName: head?.headName || "",
        reason: "NOT_APPLICABLE",
        code: "NOT_APPLICABLE",
        message: verdict.reason,
      });
  }
  return { heads: selected, skipped };
}

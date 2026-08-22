// lib/commercial/shopStorefront.js
//
// STEP 3 (member Society Shops) support code.
//
// Everything here is ADDITIVE and reads the canonical Shop record only. There
// is no BusinessProfile involvement, no migration, and no second ownership
// model: a Shop is already the commercial unit, so its public storefront is
// stored on the Shop itself under `storefront`.
//
// Two responsibilities:
//   1. Decide, on the SERVER, whether a shop is open right now. The client is
//      never allowed to compute this from raw hours, because a device with the
//      wrong clock/timezone would then show "Open" for a closed shop.
//   2. Project a Shop into member-facing DTOs that expose only public fields.
//      Owner identity, billing, area, opening balances and audit fields never
//      leave this file.

import { OPEN_STATES, DEFAULT_SHOP_TIMEZONE } from "./shopConstants";

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------
// Society hours are wall-clock hours in the society's timezone, not UTC. We
// therefore convert "now" into that timezone's calendar date, weekday and
// minute-of-day using Intl, which is available in the Node runtime these
// routes already run on (`runtime = "nodejs"`).

const WEEKDAY_INDEX = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

export function localNow(timezone = DEFAULT_SHOP_TIMEZONE, now = new Date()) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || DEFAULT_SHOP_TIMEZONE,
      weekday: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
  } catch {
    // An unknown/typo timezone must not 500 a directory read.
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: DEFAULT_SHOP_TIMEZONE,
      weekday: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
  }
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(get("hour")) % 24; // Intl can emit "24" at midnight.
  const minute = Number(get("minute"));
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    dayOfWeek: WEEKDAY_INDEX[get("weekday")] ?? 0,
    minutes: hour * 60 + minute,
  };
}

export function parseHhMm(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatHhMm(totalMinutes) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const h = String(Math.floor(normalized / 60)).padStart(2, "0");
  const m = String(normalized % 60).padStart(2, "0");
  return `${h}:${m}`;
}

// An interval whose closing time is <= its opening time crosses midnight
// (a 22:00-01:00 chemist). It is normalised to end at 24:00 for "today",
// which is the only day this computation answers for.
function normalizeIntervals(intervals) {
  const out = [];
  for (const interval of intervals ?? []) {
    const opensAt = parseHhMm(interval?.opensAt);
    const closesAt = parseHhMm(interval?.closesAt);
    if (opensAt === null || closesAt === null) continue;
    out.push({ opensAt, closesAt: closesAt <= opensAt ? 1440 : closesAt });
  }
  return out.sort((a, b) => a.opensAt - b.opensAt);
}

// Today's effective intervals: a dated override always wins over the weekly
// pattern, which is what "weekly hours + overrides" means.
export function effectiveIntervalsFor(storefront, local) {
  const override = (storefront?.hourOverrides ?? []).find((o) => o?.date === local.date);
  if (override) {
    if (override.isClosed !== false) return { intervals: [], source: "override", label: override.label ?? null };
    return { intervals: normalizeIntervals(override.intervals), source: "override", label: override.label ?? null };
  }
  const day = (storefront?.weeklyHours ?? []).find((d) => Number(d?.dayOfWeek) === local.dayOfWeek);
  if (!day) return { intervals: [], source: "weekly", label: null };
  if (day.isClosed === true) return { intervals: [], source: "weekly", label: null };
  return { intervals: normalizeIntervals(day.intervals), source: "weekly", label: null };
}

/**
 * Server-authoritative open/closed decision for one shop.
 *
 * Precedence, highest first:
 *   1. not published / not active  -> UNPUBLISHED (never shown to members)
 *   2. owner's manual "closed now" -> TEMPORARILY_CLOSED
 *   3. dated override for today    -> OPEN / CLOSED per the override
 *   4. weekly pattern             -> OPEN / CLOSED
 *   5. no hours configured at all  -> UNKNOWN (show contact details, no badge)
 */
// Hours-only decision, ignoring publish/active state. Used by computeOpenState
// (member-facing, gated) and by the admin list (which must show configured
// hours even for a shop that isn't listed yet — that's the point of the
// admin screen: see the gap before a resident would).
export function computeHoursState(storefront, now = new Date()) {
  const timezone = storefront?.timezone || DEFAULT_SHOP_TIMEZONE;
  if (storefront?.manualClosed === true) {
    return {
      state: OPEN_STATES.TEMPORARILY_CLOSED,
      timezone,
      label: "Closed by shop",
      note: storefront?.manualClosedNote ?? null,
      opensAt: null,
      closesAt: null,
    };
  }

  const local = localNow(timezone, now);
  const { intervals } = effectiveIntervalsFor(storefront, local);
  const hasWeekly = (storefront?.weeklyHours ?? []).length > 0;
  const hasOverrideToday = (storefront?.hourOverrides ?? []).some((o) => o?.date === local.date);
  if (!hasWeekly && !hasOverrideToday) {
    return { state: OPEN_STATES.UNKNOWN, timezone, label: "Hours not set", opensAt: null, closesAt: null };
  }

  const current = intervals.find((i) => local.minutes >= i.opensAt && local.minutes < i.closesAt);
  if (current) {
    return {
      state: OPEN_STATES.OPEN,
      timezone,
      label: `Open until ${formatHhMm(current.closesAt)}`,
      opensAt: formatHhMm(current.opensAt),
      closesAt: formatHhMm(current.closesAt),
    };
  }
  const next = intervals.find((i) => i.opensAt > local.minutes);
  return {
    state: OPEN_STATES.CLOSED,
    timezone,
    label: next ? `Opens at ${formatHhMm(next.opensAt)}` : "Closed today",
    opensAt: next ? formatHhMm(next.opensAt) : null,
    closesAt: null,
  };
}

export function computeOpenState(shop, now = new Date()) {
  const storefront = shop?.storefront ?? {};
  const timezone = storefront.timezone || DEFAULT_SHOP_TIMEZONE;
  if (shop?.isActive === false || storefront.isPublished !== true) {
    return { state: OPEN_STATES.UNPUBLISHED, timezone, label: "Not available", opensAt: null, closesAt: null };
  }
  return computeHoursState(storefront, now);
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

function weeklyHoursDto(storefront) {
  return (storefront?.weeklyHours ?? [])
    .map((d) => ({
      dayOfWeek: Number(d?.dayOfWeek ?? 0),
      isClosed: d?.isClosed === true,
      intervals: (d?.intervals ?? [])
        .filter((i) => parseHhMm(i?.opensAt) !== null && parseHhMm(i?.closesAt) !== null)
        .map((i) => ({ opensAt: i.opensAt, closesAt: i.closesAt })),
    }))
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek);
}

export function unitLabelFor(shop) {
  return [shop?.wing, shop?.shopNo].filter(Boolean).join("-");
}

// Directory card. Deliberately small: this is the list payload.
export function toMemberShopSummaryDto(shop, { now = new Date() } = {}) {
  if (!shop) return null;
  const storefront = shop.storefront ?? {};
  return {
    id: String(shop._id),
    tradeName: shop.tradeName || storefront.displayName || `Shop ${shop.shopNo}`,
    unitLabel: unitLabelFor(shop),
    unitKind: shop.unitKind ?? "Shop",
    categoryId: shop.categoryId ? String(shop.categoryId) : null,
    tagline: storefront.tagline ?? null,
    logoKey: storefront.logoKey ?? null,
    coverKey: storefront.coverKey ?? null,
    mediaVersion: storefront.mediaVersion ?? 0,
    pickupEnabled: storefront.pickupEnabled === true,
    deliveryEnabled: storefront.deliveryEnabled === true,
    serviceOnly: storefront.serviceOnly === true,
    openState: computeOpenState(shop, now),
  };
}

// Shop detail. Adds description, hours, fulfilment and public contact only.
export function toMemberShopDetailDto(shop, { now = new Date() } = {}) {
  if (!shop) return null;
  const storefront = shop.storefront ?? {};
  return {
    ...toMemberShopSummaryDto(shop, { now }),
    description: storefront.description ?? null,
    floor: typeof shop.floor === "number" ? shop.floor : null,
    phone: storefront.publicPhone ?? null,
    whatsapp: storefront.publicWhatsapp ?? null,
    email: storefront.publicEmail ?? null,
    deliveryNote: storefront.deliveryNote ?? null,
    minOrderAmount:
      typeof storefront.minOrderAmount === "number" ? storefront.minOrderAmount : null,
    offlinePaymentMethods: storefront.offlinePaymentMethods ?? [],
    timezone: storefront.timezone || DEFAULT_SHOP_TIMEZONE,
    weeklyHours: weeklyHoursDto(storefront),
    manualClosedNote: storefront.manualClosed === true ? storefront.manualClosedNote ?? null : null,
  };
}

// Owner view (ShopShell). Adds the setup/publication state the owner needs to
// understand why their shop is or is not visible to members, plus the
// commercial fields the owner already legitimately sees on their own shop. No
// other shop is ever readable through this projection.
export function toShopOwnerDto(shop, { now = new Date() } = {}) {
  if (!shop) return null;
  const storefront = shop.storefront ?? {};
  const detail = toMemberShopDetailDto(shop, { now });
  const missing = [];
  if (!shop.tradeName) missing.push("tradeName");
  if (!shop.categoryId) missing.push("category");
  if (!(storefront.weeklyHours ?? []).length) missing.push("businessHours");
  if (
    storefront.pickupEnabled !== true &&
    storefront.deliveryEnabled !== true &&
    storefront.serviceOnly !== true
  ) {
    missing.push("fulfillment");
  }
  if (!(storefront.offlinePaymentMethods ?? []).length) missing.push("paymentMethods");
  return {
    ...detail,
    isActive: shop.isActive !== false,
    isPublished: storefront.isPublished === true,
    publishedAt: storefront.publishedAt ?? null,
    manualClosed: storefront.manualClosed === true,
    setup: {
      // The ShopShell dashboard shows real next actions instead of fake data.
      missing,
      isReadyToPublish: missing.length === 0,
    },
    owner: {
      name: shop.ownerName ?? null,
      phone: shop.ownerPhone ?? null,
      email: shop.ownerEmail ?? null,
      isResidentOwner: Boolean(shop.ownerMemberId),
    },
    areaSqft: shop.areaSqft ?? null,
    gstin: shop.gstin ?? null,
  };
}

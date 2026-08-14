// lib/commercial/shopDirectoryService.js
//
// STEP 3 — the member-facing Society Shops directory, backed by the canonical
// Shop model.
//
// Design rules enforced here, not in the route:
//   * A shop is visible to members only when the ADMIN published it
//     (storefront.isPublished) and it is live (isActive, not deleted).
//   * societyId always comes from verified claims and is part of the Mongo
//     query itself. Nothing is fetched by id and then compared afterwards,
//     because that pattern is how cross-society reads leak.
//   * Cross-society ids and non-existent ids are indistinguishable (404).
//   * Search is a bounded, escaped regex on public fields only.

import Shop from "@/models/Shop";
import { notFound } from "./errors";
import {
  DIRECTORY_PAGE_SIZE_DEFAULT,
  DIRECTORY_PAGE_SIZE_MAX,
  SEARCH_TERM_MAX_LENGTH,
} from "./constants";
import { OPEN_STATES } from "./shopConstants";
import { computeOpenState, toMemberShopDetailDto, toMemberShopSummaryDto } from "./shopStorefront";

const PUBLIC_FIELDS =
  "shopNo wing floor unitKind tradeName categoryId isActive storefront updatedAt";

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function publishedFilter(societyId) {
  return {
    societyId,
    isDeleted: { $ne: true },
    isActive: true,
    "storefront.isPublished": true,
  };
}

/**
 * @param {object} args
 * @param {string} args.societyId  from verified claims only
 * @param {string} [args.q]        free text search
 * @param {string} [args.categoryId]
 * @param {boolean} [args.openNow]
 * @param {number} [args.page]
 * @param {number} [args.pageSize]
 */
export async function listMemberShops({
  societyId,
  q,
  categoryId,
  openNow = false,
  page = 1,
  pageSize = DIRECTORY_PAGE_SIZE_DEFAULT,
}) {
  const filter = publishedFilter(societyId);
  if (categoryId) filter.categoryId = categoryId;

  const term = typeof q === "string" ? q.trim().slice(0, SEARCH_TERM_MAX_LENGTH) : "";
  if (term) {
    const rx = new RegExp(escapeRegex(term), "i");
    filter.$or = [
      { tradeName: rx },
      { shopNo: rx },
      { "storefront.tagline": rx },
      { "storefront.description": rx },
    ];
  }

  const safePageSize = Math.min(Math.max(Number(pageSize) || DIRECTORY_PAGE_SIZE_DEFAULT, 1), DIRECTORY_PAGE_SIZE_MAX);
  const safePage = Math.max(Number(page) || 1, 1);

  // "Open now" is a computed property, not a stored one, so it cannot be a
  // Mongo filter without denormalising hours (which would then go stale every
  // time a clock ticks). It is applied after projection instead, and the
  // response reports both counts so the client never shows a wrong total.
  const [rows, total] = await Promise.all([
    Shop.find(filter)
      .select(PUBLIC_FIELDS)
      .sort({ tradeName: 1, shopNo: 1 })
      .skip(openNow ? 0 : (safePage - 1) * safePageSize)
      .limit(openNow ? DIRECTORY_PAGE_SIZE_MAX * 4 : safePageSize)
      .lean(),
    Shop.countDocuments(filter),
  ]);

  const now = new Date();
  let shops = rows.map((row) => toMemberShopSummaryDto(row, { now }));
  if (openNow) {
    shops = shops.filter((s) => s.openState?.state === OPEN_STATES.OPEN);
    const start = (safePage - 1) * safePageSize;
    shops = shops.slice(start, start + safePageSize);
  }

  return {
    shops,
    page: safePage,
    pageSize: safePageSize,
    total,
    hasMore: openNow ? shops.length === safePageSize : safePage * safePageSize < total,
  };
}

export async function getMemberShop({ societyId, shopId }) {
  const shop = await Shop.findOne({ _id: shopId, ...publishedFilter(societyId) })
    .select(PUBLIC_FIELDS)
    .lean()
    .catch(() => null);
  if (!shop) throw notFound();
  return toMemberShopDetailDto(shop, { now: new Date() });
}

// Used by the dashboard entry point: a count plus how many are open right
// now, so the member card can say something true without loading the list.
export async function memberShopsSummary({ societyId }) {
  const rows = await Shop.find(publishedFilter(societyId))
    .select("storefront isActive")
    .limit(500)
    .lean();
  const now = new Date();
  const openCount = rows.filter((r) => computeOpenState(r, now).state === OPEN_STATES.OPEN).length;
  return { total: rows.length, openNow: openCount };
}

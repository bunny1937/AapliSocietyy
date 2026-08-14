// lib/commercial/shopProductService.js
//
// STEP 4/5 — the shop's item list, from both sides:
//   * the OWNER manages it (exact stock numbers, inactive items, prices)
//   * the MEMBER browses it (names, prices, and "Available / Low / Out")
//
// Two rules are enforced here rather than in the routes, so they cannot be
// forgotten by a new caller:
//
//   1. The owner's shop id comes from `claims.shopId`, never from the request.
//      Every owner query below is keyed on societyId + shopId together.
//
//   2. Members never learn exact stock. `quantity` is a shop's commercial
//      information, and publishing it invites both scraping and "they had 2
//      left an hour ago" arguments at the counter. The member DTO carries a
//      state word only.

import Shop from "@/models/Shop";
import ShopProduct from "@/models/ShopProduct";
import { logAudit } from "@/lib/audit-logger";
import { CommercialError, notFound } from "./errors";
import { assertCategoryUsable } from "./categoryService";
import { ORDER_AUDIT_ACTIONS } from "./orderConstants";
import {
  SHOP_PRODUCT_PAGE_SIZE_DEFAULT,
  SHOP_PRODUCT_PAGE_SIZE_MAX,
  STOCK_STATES,
} from "./shopConstants";
// One search-length cap for the whole commercial module, reused rather than
// redefined so a longer term cannot be accepted here than in the directory.
import { SEARCH_TERM_MAX_LENGTH } from "./constants";

const SEARCH_MAX = SEARCH_TERM_MAX_LENGTH;

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pageBounds({ page, pageSize }) {
  const safePageSize = Math.min(
    Math.max(Number(pageSize) || SHOP_PRODUCT_PAGE_SIZE_DEFAULT, 1),
    SHOP_PRODUCT_PAGE_SIZE_MAX,
  );
  const safePage = Math.max(Number(page) || 1, 1);
  return { safePage, safePageSize, skip: (safePage - 1) * safePageSize };
}

// ---------------------------------------------------------------------------
// Shop resolution
// ---------------------------------------------------------------------------

/**
 * The owner's own shop. `shopId` must already have come from verified claims.
 * A deleted or deactivated shop is treated as absent: an owner whose shop the
 * society switched off must not keep selling through the API.
 */
export async function assertOwnedShop({ societyId, shopId }) {
  if (!shopId) throw notFound();
  const shop = await Shop.findOne({
    _id: shopId,
    societyId,
    isDeleted: { $ne: true },
  })
    .lean()
    .catch(() => null);
  if (!shop) throw notFound();
  if (shop.isActive === false) {
    throw new CommercialError(403, "This shop is not active", "SHOP_INACTIVE");
  }
  return shop;
}

/**
 * A shop as a MEMBER may see it: same society, active, and published by the
 * society admin. Unpublished, deleted, cross-society and non-existent all give
 * the same 404 so the endpoint cannot be used to enumerate shops.
 */
export async function assertPublishedShop({ societyId, shopId }) {
  if (!shopId) throw notFound();
  const shop = await Shop.findOne({
    _id: shopId,
    societyId,
    isDeleted: { $ne: true },
    isActive: true,
    "storefront.isPublished": true,
  })
    .lean()
    .catch(() => null);
  if (!shop) throw notFound();
  return shop;
}

// ---------------------------------------------------------------------------
// Stock language
// ---------------------------------------------------------------------------

/**
 * The one place that turns stock numbers into the words a member reads.
 *
 * A shop that does not track stock is simply "available" — it is not "unknown",
 * because a tailor or a salon has nothing to count and a hedge word would only
 * make the member hesitate.
 */
export function stockStateFor(product) {
  if (product?.trackStock !== true) {
    return { state: STOCK_STATES.AVAILABLE, tracked: false, canOrder: true };
  }
  const available = Math.max(0, Number(product.quantity || 0) - Number(product.reservedQuantity || 0));
  if (available <= 0) {
    return { state: STOCK_STATES.OUT_OF_STOCK, tracked: true, canOrder: false };
  }
  const threshold = Number(product.lowStockThreshold || 0);
  if (threshold > 0 && available <= threshold) {
    return { state: STOCK_STATES.LOW, tracked: true, canOrder: true };
  }
  return { state: STOCK_STATES.AVAILABLE, tracked: true, canOrder: true };
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export function toOwnerProductDto(product) {
  if (!product) return null;
  const stock = stockStateFor(product);
  return {
    id: String(product._id),
    name: product.name,
    description: product.description || "",
    unitLabel: product.unitLabel || "",
    price: product.price,
    categoryId: product.categoryId ? String(product.categoryId) : null,
    imageKey: product.imageKey ?? null,
    isActive: product.isActive !== false,
    trackStock: product.trackStock === true,
    // The owner sees the real numbers, including what is currently promised to
    // orders — otherwise "I have 10" and "only 3 are sellable" look like a bug.
    quantity: Number(product.quantity || 0),
    reservedQuantity: Number(product.reservedQuantity || 0),
    availableQuantity:
      product.trackStock === true
        ? Math.max(0, Number(product.quantity || 0) - Number(product.reservedQuantity || 0))
        : null,
    lowStockThreshold: Number(product.lowStockThreshold || 0),
    sortOrder: Number(product.sortOrder ?? 100),
    stockState: stock.state,
    updatedAt: product.updatedAt ?? null,
  };
}

export function toMemberProductDto(product) {
  if (!product) return null;
  const stock = stockStateFor(product);
  return {
    id: String(product._id),
    name: product.name,
    description: product.description || "",
    unitLabel: product.unitLabel || "",
    price: product.price,
    categoryId: product.categoryId ? String(product.categoryId) : null,
    imageKey: product.imageKey ?? null,
    // Words, never numbers.
    stockState: stock.state,
    inStock: stock.canOrder,
  };
}

// ---------------------------------------------------------------------------
// Owner: read
// ---------------------------------------------------------------------------

export async function listOwnerProducts({ societyId, shopId, q, includeInactive = true, page, pageSize }) {
  const filter = { societyId, shopId, isDeleted: false };
  if (!includeInactive) filter.isActive = true;
  const term = typeof q === "string" ? q.trim().slice(0, SEARCH_MAX) : "";
  if (term) filter.name = new RegExp(escapeRegex(term), "i");

  const { safePage, safePageSize, skip } = pageBounds({ page, pageSize });
  const [rows, total] = await Promise.all([
    ShopProduct.find(filter).sort({ sortOrder: 1, name: 1 }).skip(skip).limit(safePageSize).lean(),
    ShopProduct.countDocuments(filter),
  ]);
  return {
    products: rows.map(toOwnerProductDto),
    page: safePage,
    pageSize: safePageSize,
    total,
    hasMore: safePage * safePageSize < total,
  };
}

/**
 * Counts for the owner's dashboard and inventory header. Cheap aggregate
 * instead of loading the catalogue — the dashboard must not get slower as a
 * shop adds items.
 */
export async function ownerCatalogSummary({ societyId, shopId }) {
  const rows = await ShopProduct.find({ societyId, shopId, isDeleted: false })
    .select("isActive trackStock quantity reservedQuantity lowStockThreshold")
    .lean();
  let active = 0;
  let low = 0;
  let out = 0;
  for (const row of rows) {
    if (row.isActive !== false) active += 1;
    if (row.trackStock !== true) continue;
    const state = stockStateFor(row).state;
    if (state === STOCK_STATES.OUT_OF_STOCK) out += 1;
    else if (state === STOCK_STATES.LOW) low += 1;
  }
  return { total: rows.length, active, lowStock: low, outOfStock: out };
}

// ---------------------------------------------------------------------------
// Owner: write
// ---------------------------------------------------------------------------

function duplicateNameError() {
  return new CommercialError(
    409,
    "You already have an item with this name",
    "DUPLICATE_PRODUCT",
  );
}

export async function createOwnerProduct({ societyId, shopId, userId, input }) {
  await assertOwnedShop({ societyId, shopId });
  if (input.categoryId) await assertCategoryUsable(societyId, input.categoryId);

  try {
    const created = await ShopProduct.create({
      societyId,
      shopId,
      categoryId: input.categoryId ?? null,
      name: input.name,
      description: input.description ?? "",
      unitLabel: input.unitLabel ?? "",
      price: input.price,
      imageKey: input.imageKey ?? null,
      isActive: input.isActive !== false,
      trackStock: input.trackStock === true,
      quantity: input.trackStock === true ? (input.quantity ?? 0) : 0,
      lowStockThreshold: input.trackStock === true ? (input.lowStockThreshold ?? 0) : 0,
      sortOrder: input.sortOrder ?? 100,
      createdBy: userId ?? null,
      updatedBy: userId ?? null,
    });
    await logAudit(userId, societyId, ORDER_AUDIT_ACTIONS.PRODUCT_CREATED, null, {
      _id: created._id,
      shopId,
      name: created.name,
      price: created.price,
    });
    return toOwnerProductDto(created.toObject());
  } catch (err) {
    if (err?.code === 11000) throw duplicateNameError();
    throw err;
  }
}

export async function updateOwnerProduct({ societyId, shopId, productId, userId, input }) {
  await assertOwnedShop({ societyId, shopId });
  // Scoped find: a product id from another shop simply does not exist here.
  const product = await ShopProduct.findOne({
    _id: productId,
    societyId,
    shopId,
    isDeleted: false,
  }).catch(() => null);
  if (!product) throw notFound();

  if (input.categoryId) await assertCategoryUsable(societyId, input.categoryId);

  const before = {
    name: product.name,
    price: product.price,
    isActive: product.isActive,
    trackStock: product.trackStock,
    quantity: product.quantity,
    lowStockThreshold: product.lowStockThreshold,
  };

  const assign = [
    "name",
    "description",
    "unitLabel",
    "price",
    "categoryId",
    "imageKey",
    "isActive",
    "trackStock",
    "lowStockThreshold",
    "sortOrder",
  ];
  for (const key of assign) {
    if (input[key] !== undefined) product[key] = input[key];
  }

  // Stock needs care. `quantity` is what physically exists; it may not be set
  // below what is already promised to live orders, or the shop would show a
  // negative sellable count and the next member would be told "available" for
  // something already sold.
  const willTrack = input.trackStock !== undefined ? input.trackStock === true : product.trackStock === true;
  if (willTrack && input.quantity !== undefined) {
    const reserved = Number(product.reservedQuantity || 0);
    if (input.quantity < reserved) {
      throw new CommercialError(
        409,
        `${reserved} of these are already promised to open orders. Set the count to ${reserved} or more, or finish those orders first.`,
        "STOCK_BELOW_RESERVED",
      );
    }
    product.quantity = input.quantity;
  }
  if (!willTrack) {
    // Turning tracking off must not silently free stock that live orders are
    // still counting on — the reservation stays, it simply stops gating sales.
    product.trackStock = false;
  }

  product.updatedBy = userId ?? null;

  try {
    await product.save();
  } catch (err) {
    if (err?.code === 11000) throw duplicateNameError();
    throw err;
  }

  await logAudit(userId, societyId, ORDER_AUDIT_ACTIONS.PRODUCT_UPDATED, before, {
    _id: product._id,
    shopId,
    name: product.name,
    price: product.price,
    isActive: product.isActive,
    trackStock: product.trackStock,
    quantity: product.quantity,
  });
  return toOwnerProductDto(product.toObject());
}

/**
 * Soft delete. Past orders keep their own snapshots, so removing an item never
 * changes order history — and the row survives so reserved stock on any live
 * order can still be returned.
 */
export async function deleteOwnerProduct({ societyId, shopId, productId, userId }) {
  await assertOwnedShop({ societyId, shopId });
  const product = await ShopProduct.findOne({
    _id: productId,
    societyId,
    shopId,
    isDeleted: false,
  }).catch(() => null);
  if (!product) throw notFound();

  if (Number(product.reservedQuantity || 0) > 0) {
    throw new CommercialError(
      409,
      "This item is part of orders you have not finished yet. Complete or cancel those orders first, or just switch the item off.",
      "PRODUCT_IN_OPEN_ORDERS",
    );
  }

  product.isDeleted = true;
  product.deletedAt = new Date();
  product.isActive = false;
  product.updatedBy = userId ?? null;
  await product.save();
  await logAudit(userId, societyId, ORDER_AUDIT_ACTIONS.PRODUCT_DELETED, { name: product.name }, {
    _id: product._id,
    shopId,
  });
  return { id: String(product._id), deleted: true };
}

// ---------------------------------------------------------------------------
// Member: read
// ---------------------------------------------------------------------------

export async function listMemberProducts({ societyId, shopId, q, categoryId, page, pageSize }) {
  // Published-shop check first: an unpublished shop's catalogue must not be
  // readable just because the caller knows a product endpoint.
  await assertPublishedShop({ societyId, shopId });

  const filter = { societyId, shopId, isDeleted: false, isActive: true };
  if (categoryId) filter.categoryId = categoryId;
  const term = typeof q === "string" ? q.trim().slice(0, SEARCH_MAX) : "";
  if (term) {
    const rx = new RegExp(escapeRegex(term), "i");
    filter.$or = [{ name: rx }, { description: rx }];
  }

  const { safePage, safePageSize, skip } = pageBounds({ page, pageSize });
  const [rows, total] = await Promise.all([
    ShopProduct.find(filter)
      .select("name description unitLabel price categoryId imageKey trackStock quantity reservedQuantity lowStockThreshold sortOrder")
      .sort({ sortOrder: 1, name: 1 })
      .skip(skip)
      .limit(safePageSize)
      .lean(),
    ShopProduct.countDocuments(filter),
  ]);

  return {
    products: rows.map(toMemberProductDto),
    page: safePage,
    pageSize: safePageSize,
    total,
    hasMore: safePage * safePageSize < total,
  };
}

export async function getMemberProduct({ societyId, shopId, productId }) {
  await assertPublishedShop({ societyId, shopId });
  const product = await ShopProduct.findOne({
    _id: productId,
    societyId,
    shopId,
    isDeleted: false,
    isActive: true,
  })
    .lean()
    .catch(() => null);
  if (!product) throw notFound();
  return toMemberProductDto(product);
}

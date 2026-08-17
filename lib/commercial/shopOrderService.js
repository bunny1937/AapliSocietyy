// lib/commercial/shopOrderService.js
//
// STEP 6/7 — checkout, the order pipeline, and stock reservation.
//
// This is the file where correctness actually matters, so the reasoning is
// written down rather than implied:
//
// MONEY IS NEVER TAKEN FROM THE CLIENT. The app sends product ids and
// quantities. Prices, line totals and the order total are read from the
// database at placement time and stored as a snapshot. A tampered cart cannot
// buy a ₹500 item for ₹5, and a price change tomorrow cannot rewrite what a
// member already ordered.
//
// STOCK IS RESERVED AT PLACEMENT, and reserved with a CONDITIONAL update:
//
//   updateOne({ _id, ..., $expr: { $gte: [ quantity - reservedQuantity, n ] } },
//             { $inc: { reservedQuantity: n } })
//
// The condition and the increment are one atomic operation inside MongoDB, so
// two members checking out the last two packets at the same moment cannot both
// succeed — the second one's filter no longer matches and it is told the item
// just ran out. A read-then-write ("check stock, then save") would let both
// through, which is exactly the oversell the shop would have to apologise for.
//
// RESERVED STOCK IS RETURNED EXACTLY ONCE. Rejection and cancellation release
// it; completion consumes it. Both are guarded by flags on the order
// (stockReleased / stockConsumed) so a retried request cannot credit a shop
// with stock it does not have.
//
// AUTHORISATION. A member may only read and cancel orders whose
// customer.userId is their own user id. An owner may only see orders whose
// shopId equals claims.shopId. Neither id is ever accepted from the request.

import crypto from "node:crypto";
import Member from "@/models/Member";
import Shop from "@/models/Shop";
import ShopOrder from "@/models/ShopOrder";
import ShopProduct from "@/models/ShopProduct";
import { logAudit } from "@/lib/audit-logger";
import { sendInApp } from "@/lib/visitor-channels";
import { CommercialError, notFound } from "./errors";
import { withTransaction } from "./transactions";
import { assertOwnedShop, assertPublishedShop } from "./shopProductService";
import { computeOpenState } from "./shopStorefront";
import {
  ACTIVE_ORDER_STATUSES,
  MEMBER_CANCELLABLE_STATUSES,
  MEMBER_STATUS_MESSAGES,
  ORDER_AUDIT_ACTIONS,
  ORDER_PAGE_SIZE_DEFAULT,
  ORDER_PAGE_SIZE_MAX,
  ORDER_STATUSES,
  OWNER_ORDER_ACTIONS,
  ownerActionsFor,
  memberCanCancel,
  STOCK_RELEASING_STATUSES,
} from "./orderConstants";
import {
  FULFILLMENT_TYPES,
  OPEN_STATES,
  PAYMENT_METHODS_BY_FULFILLMENT,
} from "./shopConstants";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pageBounds({ page, pageSize }) {
  const safePageSize = Math.min(
    Math.max(Number(pageSize) || ORDER_PAGE_SIZE_DEFAULT, 1),
    ORDER_PAGE_SIZE_MAX,
  );
  const safePage = Math.max(Number(page) || 1, 1);
  return { safePage, safePageSize, skip: (safePage - 1) * safePageSize };
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

// ORD-260814-7K2Q. Short enough to read out at a counter, dated so an owner can
// see at a glance which day an order belongs to, and random rather than
// sequential so one shop cannot infer another's order volume.
function buildOrderNumber(now = new Date()) {
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0, no I/1
  let suffix = "";
  const bytes = crypto.randomBytes(4);
  for (let i = 0; i < 4; i += 1) suffix += alphabet[bytes[i] % alphabet.length];
  return `ORD-${yy}${mm}${dd}-${suffix}`;
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

function itemDto(item) {
  return {
    productId: String(item.productId),
    name: item.name,
    unitLabel: item.unitLabel || "",
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    lineTotal: item.lineTotal,
  };
}

function timelineDto(order) {
  return (order.statusHistory ?? []).map((event) => ({
    status: event.status,
    at: event.at,
    actor: event.byActor,
    reason: event.reason ?? null,
  }));
}

export function toMemberOrderDto(order) {
  if (!order) return null;
  return {
    id: String(order._id),
    orderNumber: order.orderNumber,
    shopId: String(order.shopId),
    shopName: order.shopSnapshot?.tradeName || "Shop",
    shopUnitLabel: order.shopSnapshot?.unitLabel || "",
    shopPhone: order.shopSnapshot?.phone || null,
    status: order.status,
    items: (order.items ?? []).map(itemDto),
    itemsTotal: order.itemsTotal,
    deliveryFee: order.deliveryFee ?? 0,
    total: order.total,
    fulfillmentType: order.fulfillmentType,
    paymentMethod: order.paymentMethod,
    deliveryNote: order.deliveryNote || "",
    flatLabel: order.customer?.flatLabel || "",
    placedAt: order.placedAt ?? order.createdAt ?? null,
    completedAt: order.completedAt ?? null,
    rejectionReason: order.rejectionReason ?? null,
    cancellationReason: order.cancellationReason ?? null,
    cancelledBy: order.cancelledBy ?? null,
    // The server decides whether the Cancel button exists. The rule ("only
    // before the shop starts preparing") then cannot drift between the two
    // surfaces, and a stale screen's cancel attempt is still rejected below.
    canCancel: memberCanCancel(order),
    timeline: timelineDto(order),
  };
}

export function toShopOrderDto(order) {
  if (!order) return null;
  return {
    id: String(order._id),
    orderNumber: order.orderNumber,
    status: order.status,
    items: (order.items ?? []).map(itemDto),
    itemsTotal: order.itemsTotal,
    total: order.total,
    fulfillmentType: order.fulfillmentType,
    paymentMethod: order.paymentMethod,
    paymentCollected: order.paymentCollected === true,
    deliveryNote: order.deliveryNote || "",
    customer: {
      name: order.customer?.name || "Resident",
      // The shop is delivering to a flat and may need to call about the order,
      // so flat and phone are shown. Nothing else about the member is.
      phone: order.customer?.phone || null,
      flatLabel: order.customer?.flatLabel || "",
    },
    placedAt: order.placedAt ?? order.createdAt ?? null,
    acceptedAt: order.acceptedAt ?? null,
    readyAt: order.readyAt ?? null,
    completedAt: order.completedAt ?? null,
    rejectionReason: order.rejectionReason ?? null,
    cancellationReason: order.cancellationReason ?? null,
    cancelledBy: order.cancelledBy ?? null,
    availableActions: ownerActionsFor(order),
    timeline: timelineDto(order),
  };
}

// ---------------------------------------------------------------------------
// Stock movement
// ---------------------------------------------------------------------------

/**
 * Reserve one line. Returns true when the reservation was made.
 *
 * The `$expr` guard is what makes this safe under concurrency: MongoDB
 * evaluates it against the document it is about to modify, so the check and the
 * increment cannot be interleaved by another checkout.
 */
async function reserveLine({ product, quantity, session }) {
  if (product.trackStock !== true) return true;
  const res = await ShopProduct.updateOne(
    {
      _id: product._id,
      societyId: product.societyId,
      shopId: product.shopId,
      isDeleted: false,
      isActive: true,
      trackStock: true,
      $expr: {
        $gte: [{ $subtract: ["$quantity", "$reservedQuantity"] }, quantity],
      },
    },
    { $inc: { reservedQuantity: quantity } },
    session ? { session } : {},
  );
  return res.modifiedCount === 1;
}

async function unreserveLine({ productId, quantity, session }) {
  await ShopProduct.updateOne(
    { _id: productId },
    { $inc: { reservedQuantity: -Math.abs(quantity) } },
    session ? { session } : {},
  );
}

/**
 * Give reserved stock back to the shop. Called when an order is rejected or
 * cancelled. `$max: { reservedQuantity: 0 }` in a second step would be wrong
 * (it could hide a real accounting bug), so the decrement is clamped instead:
 * the pipeline update below can never take the field below zero.
 */
async function releaseReservedStock({ order, session }) {
  for (const item of order.items ?? []) {
    if (item.stockReserved !== true) continue;
    await ShopProduct.updateOne(
      { _id: item.productId },
      [
        {
          $set: {
            reservedQuantity: {
              $max: [0, { $subtract: ["$reservedQuantity", item.quantity] }],
            },
          },
        },
      ],
      session ? { session } : {},
    );
  }
}

/**
 * The goods left the shop: the reservation becomes a real deduction. Both
 * numbers move together, clamped at zero, in one atomic pipeline update per
 * line — so a shop's stock cannot go negative even if its counts were edited
 * while the order was open.
 */
async function consumeReservedStock({ order, session }) {
  for (const item of order.items ?? []) {
    if (item.stockReserved !== true) continue;
    await ShopProduct.updateOne(
      { _id: item.productId },
      [
        {
          $set: {
            quantity: { $max: [0, { $subtract: ["$quantity", item.quantity] }] },
            reservedQuantity: {
              $max: [0, { $subtract: ["$reservedQuantity", item.quantity] }],
            },
          },
        },
      ],
      session ? { session } : {},
    );
  }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
// Best-effort by design: sendInApp already swallows its own failures, and a
// notification that cannot be delivered must never fail an order that was
// successfully placed. The order row is the record; the notification is a
// convenience.

async function notifyShopOfNewOrder({ shop, order }) {
  if (!shop?.ownerUserId) return;
  await sendInApp({
    societyId: order.societyId,
    createdBy: order.customer.userId,
    createdByName: order.customer.name || "Resident",
    type: "SHOP_ORDER_PLACED",
    title: `New order ${order.orderNumber}`,
    message: `${order.customer.flatLabel || "A resident"} ordered ${order.items.length} item${
      order.items.length === 1 ? "" : "s"
    } · ₹${order.total}`,
    priority: "high",
    recipientType: "user",
    recipientIds: [String(shop.ownerUserId)],
    actionUrl: "/shop",
    metadata: { orderId: String(order._id), shopId: String(order.shopId) },
  });
}

async function notifyMemberOfStatus({ order, status, reason }) {
  const base = MEMBER_STATUS_MESSAGES[status];
  if (!base) return;
  await sendInApp({
    societyId: order.societyId,
    createdBy: order.customer.userId,
    createdByName: order.shopSnapshot?.tradeName || "Shop",
    type: "SHOP_ORDER_UPDATED",
    title: `${order.shopSnapshot?.tradeName || "Your order"} · ${order.orderNumber}`,
    message: reason ? `${base} ${reason}` : base,
    recipientType: "user",
    recipientIds: [String(order.customer.userId)],
    actionUrl: "/orders",
    metadata: { orderId: String(order._id), status },
  });
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

function assertFulfillmentAllowed({ shop, fulfillmentType, paymentMethod }) {
  const storefront = shop.storefront ?? {};
  const enabled =
    fulfillmentType === FULFILLMENT_TYPES.PICKUP
      ? storefront.pickupEnabled === true
      : storefront.deliveryEnabled === true;
  if (!enabled) {
    throw new CommercialError(
      409,
      fulfillmentType === FULFILLMENT_TYPES.PICKUP
        ? "This shop is not accepting pickup orders"
        : "This shop is not delivering right now",
      "FULFILLMENT_UNAVAILABLE",
    );
  }
  // Two independent checks: the shop must accept the method at all, and the
  // method must make sense for the chosen fulfilment ("pay on delivery" cannot
  // apply to an order the member is collecting themselves).
  const accepted = storefront.offlinePaymentMethods ?? [];
  if (!accepted.includes(paymentMethod)) {
    throw new CommercialError(409, "This shop does not accept that payment method", "PAYMENT_METHOD_UNAVAILABLE");
  }
  const legal = PAYMENT_METHODS_BY_FULFILLMENT[fulfillmentType] ?? [];
  if (!legal.includes(paymentMethod)) {
    throw new CommercialError(
      400,
      "That payment method does not apply to this kind of order",
      "PAYMENT_METHOD_MISMATCH",
    );
  }
}

function assertShopAcceptingOrders(shop) {
  const open = computeOpenState(shop, new Date());
  if (open.state === OPEN_STATES.TEMPORARILY_CLOSED) {
    throw new CommercialError(
      409,
      open.note ? `This shop is closed right now. ${open.note}` : "This shop is closed right now",
      "SHOP_CLOSED",
    );
  }
  if (open.state === OPEN_STATES.CLOSED) {
    throw new CommercialError(
      409,
      open.label ? `This shop is closed. ${open.label}.` : "This shop is closed",
      "SHOP_CLOSED",
    );
  }
  // UNKNOWN (no hours listed) is allowed through: a shop that never entered
  // hours is still trading, and blocking its orders would punish the member for
  // the shop's missing setup.
}

/**
 * Place an order.
 *
 * @param args.claims  verified token claims (userId, memberId, societyId)
 * @param args.input   validated orderCreateSchema output
 */
export async function placeOrder({ societyId, claims, input }) {
  const userId = claims?.userId;
  if (!userId) throw new CommercialError(401, "Sign in to place an order", "NOT_AUTHENTICATED");
  // A Commercial (shop) profile is not a customer profile: the delivery address
  // of an order is a FLAT, and a shop profile has none. The app hides Society
  // Shops for shop profiles; this is the server-side half of that rule.
  if (!claims.memberId) {
    throw new CommercialError(
      403,
      "Switch to your flat profile to order from society shops",
      "MEMBER_PROFILE_REQUIRED",
    );
  }

  // Idempotency first: a retried checkout must return the ORIGINAL order and
  // must not reserve stock a second time.
  if (input.idempotencyKey) {
    const existing = await ShopOrder.findOne({
      societyId,
      "customer.userId": userId,
      idempotencyKey: input.idempotencyKey,
    }).lean();
    if (existing) return { order: toMemberOrderDto(existing), duplicate: true };
  }

  const shop = await assertPublishedShop({ societyId, shopId: input.shopId });
  assertShopAcceptingOrders(shop);
  assertFulfillmentAllowed({
    shop,
    fulfillmentType: input.fulfillmentType,
    paymentMethod: input.paymentMethod,
  });

  // Field names matter here: the owner's number on models/Member.js is
  // `contactNumber` (a `phone` field exists only inside the tenant-history
  // sub-document), so reading `member.phone` would have handed every shop an
  // order with no way to call the customer.
  const member = await Member.findOne({ _id: claims.memberId, societyId })
    .select("flatNo wing ownerName contactNumber whatsappNumber")
    .lean()
    .catch(() => null);
  if (!member) throw new CommercialError(403, "Your flat profile could not be found", "MEMBER_NOT_FOUND");
  const flatLabel = [member.wing, member.flatNo].filter(Boolean).join("-");

  // Prices come from the database, keyed to this shop and this society.
  const productIds = input.items.map((i) => i.productId);
  const products = await ShopProduct.find({
    _id: { $in: productIds },
    societyId,
    shopId: shop._id,
    isDeleted: false,
    isActive: true,
  }).lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const missing = input.items.filter((i) => !byId.has(i.productId));
  if (missing.length) {
    // The shop changed its list while the member had the cart open. Naming the
    // situation is more useful than a generic 404 the app cannot explain.
    throw new CommercialError(
      409,
      "Some items are no longer available at this shop. Please review your cart.",
      "ITEMS_UNAVAILABLE",
    );
  }

  // Per-item order-quantity limits, set by the shop on the product. Checked
  // here — not in the zod schema, which has no way to see per-product state —
  // so a limit the shop adds after the member opened the cart still holds.
  for (const item of input.items) {
    const product = byId.get(item.productId);
    if (product.minOrderQty != null && item.quantity < product.minOrderQty) {
      throw new CommercialError(
        409,
        `${product.name} requires at least ${product.minOrderQty} per order.`,
        "BELOW_MIN_ORDER_QTY",
      );
    }
    if (product.maxOrderQty != null && item.quantity > product.maxOrderQty) {
      throw new CommercialError(
        409,
        `${product.name} allows at most ${product.maxOrderQty} per order.`,
        "ABOVE_MAX_ORDER_QTY",
      );
    }
  }

  const lines = input.items.map((item) => {
    const product = byId.get(item.productId);
    const unitPrice = round2(product.price);
    return {
      productId: product._id,
      name: product.name,
      unitLabel: product.unitLabel || "",
      unitPrice,
      quantity: item.quantity,
      lineTotal: round2(unitPrice * item.quantity),
      stockReserved: product.trackStock === true,
      product,
    };
  });

  const itemsTotal = round2(lines.reduce((sum, line) => sum + line.lineTotal, 0));
  const minOrder = Number(shop.storefront?.minOrderAmount || 0);
  if (minOrder > 0 && itemsTotal < minOrder) {
    throw new CommercialError(
      409,
      `This shop's minimum order is ₹${minOrder}`,
      "BELOW_MIN_ORDER",
    );
  }
  const deliveryFee = 0; // V1: no delivery charge anywhere in the product.
  const total = round2(itemsTotal + deliveryFee);

  const created = await withTransaction(async (session) => {
    // Track what we reserved so the non-transactional fallback path (a
    // standalone mongod in development) can undo it by hand. Under a real
    // replica set the transaction does this for us.
    const applied = [];
    try {
      for (const line of lines) {
        const ok = await reserveLine({
          product: line.product,
          quantity: line.quantity,
          session,
        });
        if (!ok) {
          throw new CommercialError(
            409,
            `${line.name} just ran out. Please update your cart.`,
            "OUT_OF_STOCK",
          );
        }
        if (line.stockReserved) applied.push(line);
      }

      const now = new Date();
      // Retry only on the order-number collision, which is the one failure a
      // retry can actually fix.
      let order = null;
      for (let attempt = 0; attempt < 5 && !order; attempt += 1) {
        try {
          const docs = await ShopOrder.create(
            [
              {
                societyId,
                shopId: shop._id,
                orderNumber: buildOrderNumber(now),
                customer: {
                  userId,
                  memberId: claims.memberId,
                  profileId: claims.activeProfileId ?? null,
                  name: member.ownerName || "Resident",
                  phone: member.contactNumber || member.whatsappNumber || "",
                  flatLabel,
                },
                shopSnapshot: {
                  tradeName: shop.tradeName || `Shop ${shop.shopNo}`,
                  unitLabel: [shop.wing, shop.shopNo].filter(Boolean).join("-"),
                  phone: shop.storefront?.publicPhone || shop.ownerPhone || "",
                },
                items: lines.map(({ product, ...line }) => line),
                itemsTotal,
                deliveryFee,
                total,
                fulfillmentType: input.fulfillmentType,
                paymentMethod: input.paymentMethod,
                deliveryNote:
                  input.fulfillmentType === FULFILLMENT_TYPES.DELIVERY
                    ? (input.deliveryNote ?? "")
                    : "",
                status: ORDER_STATUSES.PLACED,
                statusHistory: [
                  { status: ORDER_STATUSES.PLACED, at: now, byUserId: userId, byActor: "member" },
                ],
                placedAt: now,
                idempotencyKey: input.idempotencyKey ?? null,
              },
            ],
            session ? { session } : {},
          );
          order = docs[0];
        } catch (err) {
          // A duplicate idempotency key means a parallel retry won the race:
          // return that order rather than creating a second one.
          if (err?.code === 11000 && String(err?.message || "").includes("idempotencyKey")) {
            throw new CommercialError(409, "This order was already placed", "DUPLICATE_ORDER");
          }
          if (err?.code === 11000 && attempt < 4) continue;
          throw err;
        }
      }
      return order;
    } catch (err) {
      if (!session) {
        for (const line of applied) {
          await unreserveLine({ productId: line.productId, quantity: line.quantity });
        }
      }
      throw err;
    }
  });

  const order = created.toObject ? created.toObject() : created;
  await notifyShopOfNewOrder({ shop, order });
  await logAudit(userId, societyId, ORDER_AUDIT_ACTIONS.ORDER_PLACED, null, {
    _id: order._id,
    shopId: String(shop._id),
    orderNumber: order.orderNumber,
    total: order.total,
    fulfillmentType: order.fulfillmentType,
  });
  return { order: toMemberOrderDto(order), duplicate: false };
}

// ---------------------------------------------------------------------------
// Member reads
// ---------------------------------------------------------------------------

export async function listMemberOrders({ societyId, userId, status, page, pageSize }) {
  const filter = { societyId, "customer.userId": userId, isDeleted: { $ne: true } };
  if (status === "active") filter.status = { $in: ACTIVE_ORDER_STATUSES };
  else if (status === "past") filter.status = { $nin: ACTIVE_ORDER_STATUSES };
  else if (status) filter.status = status;

  const { safePage, safePageSize, skip } = pageBounds({ page, pageSize });
  const [rows, total] = await Promise.all([
    ShopOrder.find(filter).sort({ createdAt: -1 }).skip(skip).limit(safePageSize).lean(),
    ShopOrder.countDocuments(filter),
  ]);
  return {
    orders: rows.map(toMemberOrderDto),
    page: safePage,
    pageSize: safePageSize,
    total,
    hasMore: safePage * safePageSize < total,
  };
}

export async function getMemberOrder({ societyId, userId, orderId }) {
  const order = await ShopOrder.findOne({
    _id: orderId,
    societyId,
    "customer.userId": userId,
  })
    .lean()
    .catch(() => null);
  if (!order) throw notFound();
  return toMemberOrderDto(order);
}

/**
 * Member cancellation. Allowed only while the shop has not started work —
 * PLACED or ACCEPTED. The status is part of the update FILTER, not checked
 * beforehand, so a cancel racing with "start preparing" cannot both apply.
 */
export async function cancelMemberOrder({ societyId, userId, orderId, reason }) {
  const now = new Date();
  const updated = await ShopOrder.findOneAndUpdate(
    {
      _id: orderId,
      societyId,
      "customer.userId": userId,
      status: { $in: MEMBER_CANCELLABLE_STATUSES },
    },
    {
      $set: {
        status: ORDER_STATUSES.CANCELLED,
        cancellationReason: reason || null,
        cancelledBy: "member",
        closedAt: now,
      },
      $push: {
        statusHistory: {
          status: ORDER_STATUSES.CANCELLED,
          at: now,
          byUserId: userId,
          byActor: "member",
          reason: reason || null,
        },
      },
    },
    { new: true },
  ).catch(() => null);

  if (!updated) {
    // Distinguish "not yours / does not exist" from "too late", because the
    // second one is a real, explainable situation for the member.
    const exists = await ShopOrder.findOne({ _id: orderId, societyId, "customer.userId": userId })
      .select("status")
      .lean()
      .catch(() => null);
    if (!exists) throw notFound();
    throw new CommercialError(
      409,
      "The shop has already started on this order, so it can no longer be cancelled. Please call the shop.",
      "CANCEL_TOO_LATE",
    );
  }

  await settleStockForClosedOrder({ orderId: updated._id });
  const shop = await Shop.findById(updated.shopId).select("ownerUserId tradeName").lean();
  if (shop?.ownerUserId) {
    await sendInApp({
      societyId,
      createdBy: userId,
      createdByName: updated.customer?.name || "Resident",
      type: "SHOP_ORDER_CANCELLED",
      title: `Order ${updated.orderNumber} cancelled`,
      message: reason
        ? `${updated.customer?.flatLabel || "A resident"} cancelled: ${reason}`
        : `${updated.customer?.flatLabel || "A resident"} cancelled this order.`,
      recipientType: "user",
      recipientIds: [String(shop.ownerUserId)],
      actionUrl: "/shop",
      metadata: { orderId: String(updated._id) },
    });
  }
  const fresh = await ShopOrder.findById(updated._id).lean();
  return toMemberOrderDto(fresh);
}

// ---------------------------------------------------------------------------
// Owner reads and transitions
// ---------------------------------------------------------------------------

export async function listShopOrders({ societyId, shopId, status, page, pageSize }) {
  await assertOwnedShop({ societyId, shopId });
  const filter = { societyId, shopId, isDeleted: { $ne: true } };
  if (status === "active") filter.status = { $in: ACTIVE_ORDER_STATUSES };
  else if (status === "past") filter.status = { $nin: ACTIVE_ORDER_STATUSES };
  else if (status) filter.status = status;

  const { safePage, safePageSize, skip } = pageBounds({ page, pageSize });
  const [rows, total] = await Promise.all([
    ShopOrder.find(filter).sort({ createdAt: -1 }).skip(skip).limit(safePageSize).lean(),
    ShopOrder.countDocuments(filter),
  ]);
  return {
    orders: rows.map(toShopOrderDto),
    page: safePage,
    pageSize: safePageSize,
    total,
    hasMore: safePage * safePageSize < total,
  };
}

export async function getShopOrder({ societyId, shopId, orderId }) {
  await assertOwnedShop({ societyId, shopId });
  const order = await ShopOrder.findOne({ _id: orderId, societyId, shopId })
    .lean()
    .catch(() => null);
  if (!order) throw notFound();
  return toShopOrderDto(order);
}

/**
 * Counts for the owner's dashboard: what needs attention now, and what the shop
 * did today. Deliberately a small aggregate rather than a page of orders — the
 * dashboard must not slow down as a shop's history grows.
 */
export async function shopOrderSummary({ societyId, shopId }) {
  await assertOwnedShop({ societyId, shopId });
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [byStatus, today] = await Promise.all([
    ShopOrder.aggregate([
      { $match: { societyId: toObjectId(societyId), shopId: toObjectId(shopId), isDeleted: { $ne: true } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    ShopOrder.aggregate([
      {
        $match: {
          societyId: toObjectId(societyId),
          shopId: toObjectId(shopId),
          status: ORDER_STATUSES.COMPLETED,
          completedAt: { $gte: startOfDay },
        },
      },
      { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: "$total" } } },
    ]),
  ]);

  const counts = {};
  for (const row of byStatus) counts[row._id] = row.count;
  const active = ACTIVE_ORDER_STATUSES.reduce((sum, s) => sum + (counts[s] || 0), 0);
  return {
    newOrders: counts[ORDER_STATUSES.PLACED] || 0,
    inProgress: active - (counts[ORDER_STATUSES.PLACED] || 0),
    activeOrders: active,
    completedToday: today[0]?.count || 0,
    // "Money the shop took today", not society billing. The two are unrelated
    // and the UI says so explicitly.
    salesToday: round2(today[0]?.amount || 0),
    byStatus: counts,
  };
}

function toObjectId(value) {
  // Aggregations do not cast strings, unlike find(). Import-free cast via the
  // model's own ObjectId type keeps this file free of a second mongoose import
  // style.
  return ShopOrder.base.Types.ObjectId.createFromHexString(String(value));
}

/**
 * Move an order along the pipeline.
 *
 * Compare-and-set: the legal source statuses are part of the update filter, so
 * two devices tapping "Accept" at once produce one accepted order and one
 * clear "this order already moved" response — never two accepts, never a
 * skipped step.
 */
export async function transitionShopOrder({ societyId, shopId, userId, orderId, action, reason, expectedStatus }) {
  await assertOwnedShop({ societyId, shopId });
  const spec = OWNER_ORDER_ACTIONS[action];
  if (!spec) throw new CommercialError(400, "Unknown action", "UNKNOWN_ACTION");
  if (spec.requiresReason && !String(reason || "").trim()) {
    throw new CommercialError(
      400,
      action === "REJECT"
        ? "Tell the resident why you are declining"
        : "Add a short reason so the resident knows what happened",
      "REASON_REQUIRED",
    );
  }

  const now = new Date();
  const set = { status: spec.to };
  if (spec.to === ORDER_STATUSES.ACCEPTED) set.acceptedAt = now;
  if (spec.to === ORDER_STATUSES.READY) set.readyAt = now;
  if (spec.to === ORDER_STATUSES.COMPLETED) {
    set.completedAt = now;
    set.closedAt = now;
    // Offline payment: the money is handed over at the same moment the order is
    // handed over, so completing it records collection.
    set.paymentCollected = true;
  }
  if (spec.to === ORDER_STATUSES.REJECTED) {
    set.rejectionReason = reason || null;
    set.closedAt = now;
  }
  if (spec.to === ORDER_STATUSES.CANCELLED) {
    set.cancellationReason = reason || null;
    set.cancelledBy = "shop";
    set.closedAt = now;
  }

  const filter = {
    _id: orderId,
    societyId,
    shopId,
    status: { $in: spec.from },
  };
  // If the owner's screen told us what it was showing, require that too. This
  // is what stops a tap made against a minutes-old list from being applied.
  if (expectedStatus) filter.status = { $in: spec.from.filter((s) => s === expectedStatus) };
  if (expectedStatus && filter.status.$in.length === 0) {
    throw new CommercialError(409, "This order has already moved on", "ORDER_STATE_CHANGED");
  }

  const updated = await ShopOrder.findOneAndUpdate(
    filter,
    {
      $set: set,
      $push: {
        statusHistory: {
          status: spec.to,
          at: now,
          byUserId: userId ?? null,
          byActor: "shop",
          reason: reason || null,
        },
      },
    },
    { new: true },
  ).catch(() => null);

  if (!updated) {
    const exists = await ShopOrder.findOne({ _id: orderId, societyId, shopId })
      .select("status")
      .lean()
      .catch(() => null);
    if (!exists) throw notFound();
    throw new CommercialError(
      409,
      `This order is already ${String(exists.status || "").toLowerCase().replace(/_/g, " ")}`,
      "ORDER_STATE_CHANGED",
    );
  }

  await settleStockForClosedOrder({ orderId: updated._id });
  await notifyMemberOfStatus({ order: updated, status: spec.to, reason });
  await logAudit(userId, societyId, ORDER_AUDIT_ACTIONS.ORDER_TRANSITIONED, { status: spec.from }, {
    _id: updated._id,
    shopId: String(shopId),
    orderNumber: updated.orderNumber,
    status: updated.status,
    action,
  });

  const fresh = await ShopOrder.findById(updated._id).lean();
  return toShopOrderDto(fresh);
}

/**
 * Apply the stock consequence of an order reaching a terminal state, exactly
 * once.
 *
 * The guard is a conditional update on the ORDER (`stockReleased: false` in the
 * filter), so even if this runs twice — a retry, two servers, a double tap —
 * only the first pass moves stock.
 */
async function settleStockForClosedOrder({ orderId }) {
  const order = await ShopOrder.findById(orderId).lean();
  if (!order) return;

  if (STOCK_RELEASING_STATUSES.includes(order.status) && order.stockReleased !== true) {
    const claimed = await ShopOrder.updateOne(
      { _id: order._id, stockReleased: { $ne: true } },
      { $set: { stockReleased: true } },
    );
    if (claimed.modifiedCount === 1) {
      await withTransaction(async (session) => {
        await releaseReservedStock({ order, session });
      });
    }
    return;
  }

  if (order.status === ORDER_STATUSES.COMPLETED && order.stockConsumed !== true) {
    const claimed = await ShopOrder.updateOne(
      { _id: order._id, stockConsumed: { $ne: true } },
      { $set: { stockConsumed: true } },
    );
    if (claimed.modifiedCount === 1) {
      await withTransaction(async (session) => {
        await consumeReservedStock({ order, session });
      });
    }
  }
}

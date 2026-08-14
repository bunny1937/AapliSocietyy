import mongoose from "mongoose";
import {
  ORDER_STATUS_VALUES,
  ORDER_STATUSES,
} from "@/lib/commercial/orderConstants";
import {
  FULFILLMENT_TYPE_VALUES,
  OFFLINE_PAYMENT_METHOD_VALUES,
} from "@/lib/commercial/shopConstants";

// One order placed by one member with one shop.
//
// SNAPSHOTS, NOT REFERENCES. Every line stores the name, unit and price as they
// were when the order was placed, and the order stores the flat and the shop's
// trade name the same way. A price change tomorrow, a renamed product, a member
// who moves flat — none of them may rewrite what someone already ordered and
// paid for. productId is kept only to return reserved stock and to let the
// owner re-open the item; it is never used to re-read the price.
//
// MONEY IS RECOMPUTED SERVER-SIDE. The client's totals are ignored entirely:
// lineTotal, itemsTotal and total below are derived from the stored product
// price at placement time inside lib/commercial/shopOrderService.js.
const OrderItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ShopProduct",
      required: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    unitLabel: { type: String, trim: true, maxlength: 24, default: "" },
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true, min: 0 },
    // Whether stock was reserved for THIS line. Stored per line because a shop
    // may track stock for packaged goods and not for made-to-order food, and
    // the release path must know which lines to give back.
    stockReserved: { type: Boolean, default: false },
  },
  { _id: false },
);

const StatusEventSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ORDER_STATUS_VALUES, required: true },
    at: { type: Date, default: Date.now },
    byUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // "member" | "shop" | "system" — who moved it, in the language of the
    // product rather than of the RBAC table.
    byActor: { type: String, enum: ["member", "shop", "system"], default: "system" },
    reason: { type: String, trim: true, maxlength: 300, default: null },
  },
  { _id: false },
);

const ShopOrderSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
      index: true,
    },
    // Human reference the member reads out at the counter.
    orderNumber: { type: String, required: true, trim: true },

    // ── who ordered ───────────────────────────────────────────────────────
    // userId is the authorisation key: only this user may read or cancel the
    // order. memberId/profileId are recorded because the same login can hold
    // several profiles and the shop must know WHICH flat is at the door.
    customer: {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
      },
      memberId: { type: mongoose.Schema.Types.ObjectId, ref: "Member", default: null },
      profileId: { type: mongoose.Schema.Types.ObjectId, default: null },
      name: { type: String, trim: true, maxlength: 120, default: "" },
      phone: { type: String, trim: true, maxlength: 20, default: "" },
      // Snapshot of the flat at placement time ("B-1204"). Delivery goes here.
      flatLabel: { type: String, trim: true, maxlength: 40, default: "" },
    },

    // ── what the shop was, when it was ordered ────────────────────────────
    shopSnapshot: {
      tradeName: { type: String, trim: true, maxlength: 120, default: "" },
      unitLabel: { type: String, trim: true, maxlength: 40, default: "" },
      phone: { type: String, trim: true, maxlength: 20, default: "" },
    },

    items: {
      type: [OrderItemSchema],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: "An order must contain at least one item.",
      },
    },
    itemsTotal: { type: Number, required: true, min: 0 },
    // V1 has no delivery charge and no gateway fee. The field exists so adding
    // one later does not require rewriting every stored total.
    deliveryFee: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },

    fulfillmentType: { type: String, enum: FULFILLMENT_TYPE_VALUES, required: true },
    // Free-text instruction from the member ("ring the bell twice", "leave with
    // the guard"). Snapshot, like the flat.
    deliveryNote: { type: String, trim: true, maxlength: 300, default: "" },
    // Offline only in V1: the money changes hands at the shop or at the door.
    // The society's own commercial billing is a separate, unrelated flow.
    paymentMethod: { type: String, enum: OFFLINE_PAYMENT_METHOD_VALUES, required: true },
    paymentCollected: { type: Boolean, default: false },

    status: {
      type: String,
      enum: ORDER_STATUS_VALUES,
      default: ORDER_STATUSES.PLACED,
      index: true,
    },
    statusHistory: { type: [StatusEventSchema], default: [] },
    placedAt: { type: Date, default: Date.now },
    acceptedAt: { type: Date, default: null },
    readyAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, maxlength: 300, default: null },
    cancellationReason: { type: String, trim: true, maxlength: 300, default: null },
    cancelledBy: { type: String, enum: ["member", "shop", "system", null], default: null },

    // Reserved stock is returned exactly once. Without this flag a retried
    // cancel request (bad network, double tap) would credit the shop's stock
    // twice and it would start selling packets it does not have.
    stockReleased: { type: Boolean, default: false },
    // Sold stock is deducted exactly once, on completion, for the same reason.
    stockConsumed: { type: Boolean, default: false },

    // Client-generated key. A checkout retried after a timeout must not create
    // a second order for the same cart — see the unique partial index below.
    idempotencyKey: { type: String, default: null },

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// The member's "My orders" list.
ShopOrderSchema.index({ societyId: 1, "customer.userId": 1, createdAt: -1 });
// The owner's queue, filtered by status.
ShopOrderSchema.index({ societyId: 1, shopId: 1, status: 1, createdAt: -1 });
ShopOrderSchema.index({ societyId: 1, orderNumber: 1 }, { unique: true });
// Idempotency is per user, so two members retrying different carts cannot
// collide, and a partial index keeps the (many) older null-key rows legal.
ShopOrderSchema.index(
  { societyId: 1, "customer.userId": 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } },
);

export default mongoose.models.ShopOrder || mongoose.model("ShopOrder", ShopOrderSchema);

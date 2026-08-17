// lib/commercial/shopCatalogSchemas.js
//
// Input validation for products, checkout and order transitions.
//
// Every object is `.strict()`. An unknown key is rejected rather than ignored,
// because silently dropping a field is how a client ends up believing it saved
// something it did not — and because it stops a caller from smuggling
// societyId, shopId, reservedQuantity or a price into a write.
//
// Note what is NOT here: prices, totals, stock levels and the shop id at
// checkout. Those are read from the database, not accepted from the client.
import { z } from "zod";
import {
  FULFILLMENT_TYPE_VALUES,
  OFFLINE_PAYMENT_METHOD_VALUES,
} from "./shopConstants";
import {
  OWNER_ORDER_ACTION_VALUES,
  ORDER_MAX_LINES,
  ORDER_MAX_QUANTITY_PER_LINE,
} from "./orderConstants";

const objectId = z
  .string()
  .trim()
  .regex(/^[a-f\d]{24}$/i, "Invalid id");

const money = z
  .number()
  .finite()
  .min(0, "Price cannot be negative")
  .max(1000000, "Price is too large");

const wholeNumber = z.number().int().min(0).max(1000000);
const orderQtyLimit = z.number().int().min(1).max(ORDER_MAX_QUANTITY_PER_LINE).nullable();

// ---------------------------------------------------------------------------
// Products (shop owner)
// ---------------------------------------------------------------------------

const productBase = {
  name: z.string().trim().min(1, "Add an item name").max(120),
  description: z.string().trim().max(600).optional(),
  unitLabel: z.string().trim().max(24).optional(),
  price: money,
  categoryId: objectId.nullable().optional(),
  imageKey: z.string().trim().max(300).nullable().optional(),
  isActive: z.boolean().optional(),
  trackStock: z.boolean().optional(),
  quantity: wholeNumber.optional(),
  lowStockThreshold: wholeNumber.optional(),
  // Per-order limits a member can buy in one line. null (the default) means
  // no limit — most shops never set these.
  minOrderQty: orderQtyLimit.optional(),
  maxOrderQty: orderQtyLimit.optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
};

// "Track stock, but I did not say how much" is not a state a shop can act on:
// it would show every item as out of stock the moment tracking is turned on.
//
// A max below a min is not a limit a member could ever satisfy — reject it
// at write time rather than let every order attempt fail against an
// impossible range.
const withStockRule = (schema) =>
  schema.superRefine((value, ctx) => {
    if (value.trackStock === true && value.quantity === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quantity"],
        message: "Enter how many you have in stock",
      });
    }
    if (
      value.minOrderQty != null &&
      value.maxOrderQty != null &&
      value.maxOrderQty < value.minOrderQty
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxOrderQty"],
        message: "Maximum order quantity must be at least the minimum",
      });
    }
  });

export const productCreateSchema = withStockRule(z.object(productBase).strict());

// Update is a patch: only the keys present are written. `quantity` is an
// absolute set, not a delta — a delta sent twice by a retry would silently
// double a stock correction.
export const productUpdateSchema = withStockRule(
  z
    .object({
      name: productBase.name.optional(),
      description: productBase.description,
      unitLabel: productBase.unitLabel,
      price: money.optional(),
      categoryId: productBase.categoryId,
      imageKey: productBase.imageKey,
      isActive: productBase.isActive,
      trackStock: productBase.trackStock,
      quantity: productBase.quantity,
      lowStockThreshold: productBase.lowStockThreshold,
      minOrderQty: productBase.minOrderQty,
      maxOrderQty: productBase.maxOrderQty,
      sortOrder: productBase.sortOrder,
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" }),
);

// ---------------------------------------------------------------------------
// Checkout (member)
// ---------------------------------------------------------------------------

export const orderCreateSchema = z
  .object({
    shopId: objectId,
    items: z
      .array(
        z
          .object({
            productId: objectId,
            quantity: z
              .number()
              .int()
              .min(1, "Quantity must be at least 1")
              .max(ORDER_MAX_QUANTITY_PER_LINE),
          })
          .strict(),
      )
      .min(1, "Your cart is empty")
      .max(ORDER_MAX_LINES, "Too many different items in one order"),
    fulfillmentType: z.enum(FULFILLMENT_TYPE_VALUES),
    paymentMethod: z.enum(OFFLINE_PAYMENT_METHOD_VALUES),
    deliveryNote: z.string().trim().max(300).optional(),
    // Sent by the app, generated once per cart. Retrying a timed-out checkout
    // with the same key returns the original order instead of a duplicate.
    idempotencyKey: z.string().trim().min(8).max(80).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set();
    value.items.forEach((item, index) => {
      if (seen.has(item.productId)) {
        // Two lines for the same product would each reserve stock and the
        // member would see the item twice on their order.
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index, "productId"],
          message: "This item is in the order twice",
        });
      }
      seen.add(item.productId);
    });
  });

export const orderCancelSchema = z
  .object({ reason: z.string().trim().max(300).optional() })
  .strict();

// ---------------------------------------------------------------------------
// Transitions (shop owner)
// ---------------------------------------------------------------------------

export const orderTransitionSchema = z
  .object({
    action: z.enum(OWNER_ORDER_ACTION_VALUES),
    reason: z.string().trim().max(300).optional(),
    // The status the owner's screen was showing. Sent back so the server can
    // reject a tap made against a stale view instead of applying it blindly.
    expectedStatus: z.string().trim().max(40).optional(),
  })
  .strict();

export function issuesFrom(parsed) {
  return parsed.error.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));
}

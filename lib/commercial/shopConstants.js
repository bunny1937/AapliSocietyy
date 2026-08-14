// lib/commercial/shopConstants.js
//
// Constants for the Shop-backed member storefront, products and orders.
//
// These live in their own file rather than being bolted onto
// lib/commercial/constants.js because that file's values are about the LEGACY
// Member-derived unit classification (flatType "Shop"/"Office", BusinessProfile
// visibility). Nothing here depends on that path, and keeping them apart makes
// it obvious which module a value belongs to.

export const DEFAULT_SHOP_TIMEZONE = "Asia/Kolkata";

// Server-computed open/closed decision. The client renders the badge, it never
// decides the state (a wrong device clock must not show a closed shop as open).
export const OPEN_STATES = {
  OPEN: "OPEN",
  CLOSED: "CLOSED",
  TEMPORARILY_CLOSED: "TEMPORARILY_CLOSED",
  UNKNOWN: "UNKNOWN",
  UNPUBLISHED: "UNPUBLISHED",
};
export const OPEN_STATE_VALUES = Object.values(OPEN_STATES);

// Fulfilment is per shop, and the shop owner turns each one on. A member can
// only choose a mode the shop actually offers.
export const FULFILLMENT_TYPES = {
  PICKUP: "PICKUP",
  DELIVERY: "DELIVERY",
};
export const FULFILLMENT_TYPE_VALUES = Object.values(FULFILLMENT_TYPES);

// V1 is offline payment only — no gateway, no wallet, no commission. The shop
// declares which of these it accepts; "pay on delivery" is only offered when
// the order is a delivery order.
export const OFFLINE_PAYMENT_METHODS = {
  PAY_AT_SHOP: "PAY_AT_SHOP",
  PAY_ON_DELIVERY: "PAY_ON_DELIVERY",
  UPI_ON_PICKUP: "UPI_ON_PICKUP",
  UPI_ON_DELIVERY: "UPI_ON_DELIVERY",
};
export const OFFLINE_PAYMENT_METHOD_VALUES = Object.values(OFFLINE_PAYMENT_METHODS);

// Which payment methods are legal for which fulfilment type. Enforced on the
// server at checkout; the picker in the app mirrors it for usability only.
export const PAYMENT_METHODS_BY_FULFILLMENT = {
  [FULFILLMENT_TYPES.PICKUP]: [
    OFFLINE_PAYMENT_METHODS.PAY_AT_SHOP,
    OFFLINE_PAYMENT_METHODS.UPI_ON_PICKUP,
  ],
  [FULFILLMENT_TYPES.DELIVERY]: [
    OFFLINE_PAYMENT_METHODS.PAY_ON_DELIVERY,
    OFFLINE_PAYMENT_METHODS.UPI_ON_DELIVERY,
  ],
};

// Member-facing stock language. The exact quantity is never exposed: it is
// competitive information and it invites screen-scraping of a shop's stock.
export const STOCK_STATES = {
  AVAILABLE: "AVAILABLE",
  LOW: "LOW",
  OUT_OF_STOCK: "OUT_OF_STOCK",
};
export const STOCK_STATE_VALUES = Object.values(STOCK_STATES);

export const SHOP_PRODUCT_PAGE_SIZE_DEFAULT = 24;
export const SHOP_PRODUCT_PAGE_SIZE_MAX = 60;

export const SHOP_AUDIT_ACTIONS = {
  SHOP_INVITED: "SHOP_OWNER_INVITED",
  SHOP_OWNER_LINKED: "SHOP_OWNER_LINKED",
  STOREFRONT_UPDATED: "SHOP_STOREFRONT_UPDATED",
  STOREFRONT_PUBLISHED: "SHOP_STOREFRONT_PUBLISHED",
  STOREFRONT_UNPUBLISHED: "SHOP_STOREFRONT_UNPUBLISHED",
};

// lib/commercial/orderConstants.js
//
// The order state machine, in one place, as data.
//
// Two rules drove this shape:
//
//   1. The client never sends a target status. It sends an ACTION ("accept",
//      "mark ready"), and the server maps that action to a transition that is
//      only legal from specific current states. A client that sends
//      status: "COMPLETED" on a brand-new order therefore cannot skip the
//      pipeline, and a stale screen cannot double-apply a step.
//
//   2. Whoever may perform an action is part of the table, not scattered
//      through route handlers. A member may cancel; a member may not mark an
//      order ready.

export const ORDER_STATUSES = {
  PLACED: "PLACED",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  PREPARING: "PREPARING",
  READY: "READY",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
};
export const ORDER_STATUS_VALUES = Object.values(ORDER_STATUSES);

// Still moving. Used for the owner's "live" queue and to stop a member from
// ordering twice by accident.
export const ACTIVE_ORDER_STATUSES = [
  ORDER_STATUSES.PLACED,
  ORDER_STATUSES.ACCEPTED,
  ORDER_STATUSES.PREPARING,
  ORDER_STATUSES.READY,
  ORDER_STATUSES.OUT_FOR_DELIVERY,
];

export const TERMINAL_ORDER_STATUSES = [
  ORDER_STATUSES.COMPLETED,
  ORDER_STATUSES.REJECTED,
  ORDER_STATUSES.CANCELLED,
];

// Reaching one of these hands reserved stock back to the shop.
export const STOCK_RELEASING_STATUSES = [ORDER_STATUSES.REJECTED, ORDER_STATUSES.CANCELLED];

// A member may cancel only BEFORE the shop starts work. Once someone is
// chopping vegetables for that order, cancelling costs them money.
export const MEMBER_CANCELLABLE_STATUSES = [ORDER_STATUSES.PLACED, ORDER_STATUSES.ACCEPTED];

/**
 * Owner actions. Each entry:
 *   from            legal current statuses (compare-and-set filter)
 *   to              resulting status
 *   requiresReason  the member is owed an explanation
 *   deliveryOnly    only meaningful for a delivery order
 *   label           what the owner's button says (kept here so the app and any
 *                   future web screen cannot disagree about what a step means)
 */
export const OWNER_ORDER_ACTIONS = {
  ACCEPT: {
    from: [ORDER_STATUSES.PLACED],
    to: ORDER_STATUSES.ACCEPTED,
    label: "Accept order",
  },
  REJECT: {
    from: [ORDER_STATUSES.PLACED],
    to: ORDER_STATUSES.REJECTED,
    requiresReason: true,
    label: "Decline order",
  },
  START_PREPARING: {
    from: [ORDER_STATUSES.ACCEPTED],
    to: ORDER_STATUSES.PREPARING,
    label: "Start preparing",
  },
  MARK_READY: {
    from: [ORDER_STATUSES.PREPARING],
    to: ORDER_STATUSES.READY,
    label: "Mark ready",
  },
  START_DELIVERY: {
    from: [ORDER_STATUSES.READY],
    to: ORDER_STATUSES.OUT_FOR_DELIVERY,
    deliveryOnly: true,
    label: "Out for delivery",
  },
  COMPLETE: {
    from: [ORDER_STATUSES.READY, ORDER_STATUSES.OUT_FOR_DELIVERY],
    to: ORDER_STATUSES.COMPLETED,
    label: "Mark completed",
  },
  // A shop that has already accepted can still hit a real problem (power cut,
  // supplier failed). That is a cancellation with a reason, not a rejection.
  CANCEL: {
    from: [
      ORDER_STATUSES.ACCEPTED,
      ORDER_STATUSES.PREPARING,
      ORDER_STATUSES.READY,
      ORDER_STATUSES.OUT_FOR_DELIVERY,
    ],
    to: ORDER_STATUSES.CANCELLED,
    requiresReason: true,
    label: "Cancel order",
  },
};
export const OWNER_ORDER_ACTION_VALUES = Object.keys(OWNER_ORDER_ACTIONS);

/**
 * The actions an owner may take on an order right now, in pipeline order.
 * Returned to the client so the buttons it shows and the transitions the
 * server will accept come from the same source.
 */
export function ownerActionsFor(order) {
  const status = order?.status;
  const isDelivery = order?.fulfillmentType === "DELIVERY";
  return OWNER_ORDER_ACTION_VALUES.filter((key) => {
    const action = OWNER_ORDER_ACTIONS[key];
    if (!action.from.includes(status)) return false;
    if (action.deliveryOnly && !isDelivery) return false;
    // A pickup order goes READY -> COMPLETED; a delivery order should go
    // through OUT_FOR_DELIVERY first, so "Mark completed" is hidden while the
    // handover step is still available.
    if (key === "COMPLETE" && isDelivery && status === ORDER_STATUSES.READY) return false;
    return true;
  }).map((key) => ({
    action: key,
    label: OWNER_ORDER_ACTIONS[key].label,
    requiresReason: OWNER_ORDER_ACTIONS[key].requiresReason === true,
  }));
}

export function memberCanCancel(order) {
  return MEMBER_CANCELLABLE_STATUSES.includes(order?.status);
}

// What the member is told when an order moves. Written for the person waiting
// for their groceries, not for a log file.
export const MEMBER_STATUS_MESSAGES = {
  [ORDER_STATUSES.ACCEPTED]: "Your order was accepted.",
  [ORDER_STATUSES.REJECTED]: "Your order was declined.",
  [ORDER_STATUSES.PREPARING]: "Your order is being prepared.",
  [ORDER_STATUSES.READY]: "Your order is ready.",
  [ORDER_STATUSES.OUT_FOR_DELIVERY]: "Your order is on the way.",
  [ORDER_STATUSES.COMPLETED]: "Your order is complete.",
  [ORDER_STATUSES.CANCELLED]: "Your order was cancelled.",
};

export const ORDER_PAGE_SIZE_DEFAULT = 20;
export const ORDER_PAGE_SIZE_MAX = 50;

// Guard rails on one order. Not a business rule so much as a blast radius:
// they stop a malformed or malicious cart from creating a 5,000-line order.
export const ORDER_MAX_LINES = 40;
export const ORDER_MAX_QUANTITY_PER_LINE = 99;

export const ORDER_AUDIT_ACTIONS = {
  PRODUCT_CREATED: "SHOP_PRODUCT_CREATED",
  PRODUCT_UPDATED: "SHOP_PRODUCT_UPDATED",
  PRODUCT_DELETED: "SHOP_PRODUCT_DELETED",
  ORDER_PLACED: "SHOP_ORDER_PLACED",
  ORDER_TRANSITIONED: "SHOP_ORDER_TRANSITIONED",
};

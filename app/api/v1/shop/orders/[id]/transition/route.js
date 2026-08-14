// POST /v1/shop/orders/:id/transition — the owner moves an order along.
//
// One endpoint for every step (accept, reject, start preparing, mark ready,
// out for delivery, complete, cancel) because the legal moves are defined once
// in lib/commercial/orderConstants.js and enforced once in the service. Adding
// a step later means editing that table, not adding another route with its own
// idea of the rules.
//
// The optional `expectedStatus` is the status the owner's screen was showing.
// Sending it turns the update into a compare-and-set, so a tap on a stale list
// is refused with 409 instead of silently skipping a step.
import { json, zodError } from "@/lib/v1/http";
import { commercialV1Route, routeParams } from "@/lib/commercial/v1Route";
import { shopOwnerContext } from "@/lib/commercial/shopOwnerContext";
import { orderTransitionSchema } from "@/lib/commercial/shopCatalogSchemas";
import { transitionShopOrder } from "@/lib/commercial/shopOrderService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = commercialV1Route("v1.shop.orders.transition", async (req, ctx) => {
  const { societyId, shopId, userId } = await shopOwnerContext(req);
  const { id } = await routeParams(ctx);
  const body = await req.json().catch(() => ({}));
  const parsed = orderTransitionSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);

  const order = await transitionShopOrder({
    societyId,
    shopId,
    userId,
    orderId: id,
    action: parsed.data.action,
    reason: parsed.data.reason,
    expectedStatus: parsed.data.expectedStatus,
  });
  return json({ order });
});

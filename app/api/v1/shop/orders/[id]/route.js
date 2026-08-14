// GET /v1/shop/orders/:id — one order in the owner's queue.
//
// Scoped to the token's shop, so an order id from another shop is a 404 and
// never leaks a resident's flat and phone number to the wrong business.
import { json } from "@/lib/v1/http";
import { commercialV1Route, routeParams } from "@/lib/commercial/v1Route";
import { shopOwnerContext } from "@/lib/commercial/shopOwnerContext";
import { getShopOrder } from "@/lib/commercial/shopOrderService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = commercialV1Route("v1.shop.orders.detail", async (req, ctx) => {
  const { societyId, shopId } = await shopOwnerContext(req);
  const { id } = await routeParams(ctx);
  const order = await getShopOrder({ societyId, shopId, orderId: id });
  return json({ order });
});

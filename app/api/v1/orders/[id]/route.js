// GET /v1/orders/:id — one of the member's own orders, with its timeline.
//
// The lookup is filtered by customer.userId, so another member's order id
// returns 404 rather than someone else's flat number and phone number.
import { json } from "@/lib/v1/http";
import { commercialV1Route, routeParams } from "@/lib/commercial/v1Route";
import { memberShopContext } from "@/lib/commercial/shopOwnerContext";
import { getMemberOrder } from "@/lib/commercial/shopOrderService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = commercialV1Route("v1.orders.detail", async (req, ctx) => {
  const { societyId, claims } = await memberShopContext(req);
  const { id } = await routeParams(ctx);
  const order = await getMemberOrder({ societyId, userId: claims.userId, orderId: id });
  return json({ order });
});

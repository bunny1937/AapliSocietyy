// POST /v1/orders/:id/cancel — member cancels their own order.
//
// Allowed only while the shop has not started preparing it (PLACED, ACCEPTED).
// The window is enforced inside the update filter, not by a prior read, so a
// cancel racing the shop's "start preparing" cannot both win. A cancel that
// arrives too late returns 409 CANCEL_TOO_LATE and the app tells the member to
// call the shop instead of pretending the order is gone.
import { json, zodError } from "@/lib/v1/http";
import { commercialV1Route, routeParams } from "@/lib/commercial/v1Route";
import { memberShopContext } from "@/lib/commercial/shopOwnerContext";
import { orderCancelSchema } from "@/lib/commercial/shopCatalogSchemas";
import { cancelMemberOrder } from "@/lib/commercial/shopOrderService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = commercialV1Route("v1.orders.cancel", async (req, ctx) => {
  const { societyId, claims } = await memberShopContext(req);
  const { id } = await routeParams(ctx);
  const body = await req.json().catch(() => ({}));
  const parsed = orderCancelSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);

  const order = await cancelMemberOrder({
    societyId,
    userId: claims.userId,
    orderId: id,
    reason: parsed.data.reason,
  });
  return json({ order });
});

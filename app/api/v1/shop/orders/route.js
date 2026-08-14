// GET /v1/shop/orders — the owner's order queue.
//
// ?status=active (default view) shows what still needs the owner: PLACED,
// ACCEPTED, PREPARING, READY, OUT_FOR_DELIVERY. ?status=past shows the closed
// ones. A single status may also be passed for a filtered tab.
import { json } from "@/lib/v1/http";
import { commercialV1Route } from "@/lib/commercial/v1Route";
import { shopOwnerContext } from "@/lib/commercial/shopOwnerContext";
import { listShopOrders } from "@/lib/commercial/shopOrderService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = commercialV1Route("v1.shop.orders.list", async (req) => {
  const { societyId, shopId } = await shopOwnerContext(req);
  const url = new URL(req.url);
  const result = await listShopOrders({
    societyId,
    shopId,
    status: url.searchParams.get("status") || "active",
    page: url.searchParams.get("page"),
    pageSize: url.searchParams.get("pageSize"),
  });
  return json(result);
});

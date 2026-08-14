// POST /v1/orders  — place an order (member)
// GET  /v1/orders  — "My orders" (member)
//
// The body carries product ids and quantities only. Prices, totals and the
// shop's own rules are applied server-side in shopOrderService.placeOrder, so a
// modified cart cannot change what anything costs.
import { json, zodError } from "@/lib/v1/http";
import { commercialV1Route } from "@/lib/commercial/v1Route";
import { memberShopContext } from "@/lib/commercial/shopOwnerContext";
import { orderCreateSchema } from "@/lib/commercial/shopCatalogSchemas";
import { listMemberOrders, placeOrder } from "@/lib/commercial/shopOrderService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = commercialV1Route("v1.orders.create", async (req) => {
  const { societyId, claims } = await memberShopContext(req);
  const body = await req.json().catch(() => ({}));
  const parsed = orderCreateSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);

  const { order, duplicate } = await placeOrder({
    societyId,
    claims,
    input: parsed.data,
  });
  // A retry that matched an existing idempotency key is a success, not a new
  // order: 200 tells the app "this is the order you already placed".
  return json({ order }, { status: duplicate ? 200 : 201 });
});

export const GET = commercialV1Route("v1.orders.list", async (req) => {
  const { societyId, claims } = await memberShopContext(req);
  const url = new URL(req.url);
  const result = await listMemberOrders({
    societyId,
    // Orders belong to the LOGIN, not to the flat: a member who switches
    // profiles still sees their own orders, and a second resident of the same
    // flat does not see them.
    userId: claims.userId,
    status: url.searchParams.get("status") || undefined,
    page: url.searchParams.get("page"),
    pageSize: url.searchParams.get("pageSize"),
  });
  return json(result);
});

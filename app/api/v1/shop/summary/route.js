// GET /v1/shop/summary — numbers for the shop owner's dashboard.
//
// One request instead of three, because the dashboard is the first screen an
// owner sees and it should not need a catalogue page and an order page to draw
// four tiles. Both halves are aggregates, so this stays fast as a shop's
// history grows.
import { json } from "@/lib/v1/http";
import { commercialV1Route } from "@/lib/commercial/v1Route";
import { shopOwnerContext } from "@/lib/commercial/shopOwnerContext";
import { ownerCatalogSummary } from "@/lib/commercial/shopProductService";
import { shopOrderSummary } from "@/lib/commercial/shopOrderService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = commercialV1Route("v1.shop.summary", async (req) => {
  const { societyId, shopId } = await shopOwnerContext(req);
  const [catalogue, orders] = await Promise.all([
    ownerCatalogSummary({ societyId, shopId }),
    shopOrderSummary({ societyId, shopId }),
  ]);
  return json({ catalogue, orders });
});

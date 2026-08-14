// GET /v1/shops/:id/products/:productId — the member's product detail sheet.
//
// Loaded fresh rather than passed through from the list, so the price and
// availability shown on the screen where the member taps "Add to cart" are the
// current ones, not whatever the list held when it was fetched.
import { json } from "@/lib/v1/http";
import { commercialV1Route, routeParams } from "@/lib/commercial/v1Route";
import { memberShopContext } from "@/lib/commercial/shopOwnerContext";
import { getMemberProduct } from "@/lib/commercial/shopProductService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = commercialV1Route("v1.shops.products.detail", async (req, ctx) => {
  const { societyId } = await memberShopContext(req);
  const { id, productId } = await routeParams(ctx);
  const product = await getMemberProduct({ societyId, shopId: id, productId });
  return json({ product });
});

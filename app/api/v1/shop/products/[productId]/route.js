// PATCH  /v1/shop/products/:productId  — edit price, stock, availability
// DELETE /v1/shop/products/:productId  — remove from the list (soft)
//
// The productId is scoped to the token's shop inside the service, so an id
// belonging to another shop returns 404 rather than editing someone else's item.
import { json, zodError } from "@/lib/v1/http";
import { commercialV1Route, routeParams } from "@/lib/commercial/v1Route";
import { shopOwnerContext } from "@/lib/commercial/shopOwnerContext";
import { productUpdateSchema } from "@/lib/commercial/shopCatalogSchemas";
import {
  deleteOwnerProduct,
  updateOwnerProduct,
} from "@/lib/commercial/shopProductService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = commercialV1Route("v1.shop.products.update", async (req, ctx) => {
  const { societyId, shopId, userId } = await shopOwnerContext(req);
  const { productId } = await routeParams(ctx);
  const body = await req.json().catch(() => ({}));
  const parsed = productUpdateSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);

  const product = await updateOwnerProduct({
    societyId,
    shopId,
    productId,
    userId,
    input: parsed.data,
  });
  return json({ product });
});

export const DELETE = commercialV1Route("v1.shop.products.delete", async (req, ctx) => {
  const { societyId, shopId, userId } = await shopOwnerContext(req);
  const { productId } = await routeParams(ctx);
  const result = await deleteOwnerProduct({ societyId, shopId, productId, userId });
  return json(result);
});

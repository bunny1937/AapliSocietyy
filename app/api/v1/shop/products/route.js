// GET  /v1/shop/products   — the owner's own catalogue (exact stock numbers)
// POST /v1/shop/products   — add an item
//
// There is no shopId in the path or the body. It comes from the token, so an
// owner cannot read or write another shop's catalogue by changing a parameter.
import { json, zodError } from "@/lib/v1/http";
import { commercialV1Route } from "@/lib/commercial/v1Route";
import { shopOwnerContext } from "@/lib/commercial/shopOwnerContext";
import { productCreateSchema } from "@/lib/commercial/shopCatalogSchemas";
import {
  createOwnerProduct,
  listOwnerProducts,
} from "@/lib/commercial/shopProductService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = commercialV1Route("v1.shop.products.list", async (req) => {
  const { societyId, shopId } = await shopOwnerContext(req);
  const url = new URL(req.url);
  const result = await listOwnerProducts({
    societyId,
    shopId,
    q: url.searchParams.get("q") ?? "",
    // The owner's inventory screen shows switched-off items too — hiding them
    // would make an item the member cannot see look deleted to the owner as
    // well, and they would add it again.
    includeInactive: url.searchParams.get("includeInactive") !== "false",
    page: url.searchParams.get("page"),
    pageSize: url.searchParams.get("pageSize"),
  });
  return json(result);
});

export const POST = commercialV1Route("v1.shop.products.create", async (req) => {
  const { societyId, shopId, userId } = await shopOwnerContext(req);
  const body = await req.json().catch(() => ({}));
  const parsed = productCreateSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);

  const product = await createOwnerProduct({
    societyId,
    shopId,
    userId,
    input: parsed.data,
  });
  return json({ product }, { status: 201 });
});

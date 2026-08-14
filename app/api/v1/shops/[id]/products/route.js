// GET /v1/shops/:id/products — what a MEMBER sees on a shop page.
//
// Only published, active shops answer, and only active items are returned.
// Stock is a word ("Available" / "Low" / "Out of stock"), never a number: the
// exact count is the shop's business information and publishing it would also
// invite arguments at the counter about numbers that moved since.
import { json } from "@/lib/v1/http";
import { commercialV1Route, routeParams } from "@/lib/commercial/v1Route";
import { memberShopContext } from "@/lib/commercial/shopOwnerContext";
import { listMemberProducts } from "@/lib/commercial/shopProductService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = commercialV1Route("v1.shops.products.list", async (req, ctx) => {
  const { societyId } = await memberShopContext(req);
  const { id } = await routeParams(ctx);
  const url = new URL(req.url);

  const result = await listMemberProducts({
    societyId,
    shopId: id,
    q: url.searchParams.get("q") ?? "",
    categoryId: url.searchParams.get("categoryId") || undefined,
    page: url.searchParams.get("page"),
    pageSize: url.searchParams.get("pageSize"),
  });
  return json(result);
});

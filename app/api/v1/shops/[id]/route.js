// GET /v1/shops/:id — one published shop in the caller's own society.
//
// A shop in another society, an unpublished shop and a non-existent id all
// return the same 404, so the endpoint cannot be used to enumerate shops.
import { json } from "@/lib/v1/http";
import { commercialContext } from "@/lib/commercial/v1Gate";
// commercialV1Route (not withRoute + withCommercialLogging) because the
// services throw CommercialError, which withRoute alone turns into a 500.
import { commercialV1Route } from "@/lib/commercial/v1Route";
import { getMemberShop } from "@/lib/commercial/shopDirectoryService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = commercialV1Route("v1.shops.detail", async (req, ctx) => {
    const { societyId } = await commercialContext(req, "directoryEnabled");
    const params = (await ctx?.params) ?? {};
    const shop = await getMemberShop({ societyId, shopId: params.id });
    return json({ shop });
});

// GET /v1/shops — member-facing Society Shops directory.
//
// Backed by the canonical Shop model (see lib/commercial/shopDirectoryService).
// The older /v1/commercial/directory route is left exactly as it is: this is a
// new, additive endpoint, not a migration of that one.
import { json } from "@/lib/v1/http";
import { commercialContext } from "@/lib/commercial/v1Gate";
// commercialV1Route (not withRoute + withCommercialLogging) because the
// services throw CommercialError, which withRoute alone turns into a 500.
import { commercialV1Route } from "@/lib/commercial/v1Route";
import { listMemberShops } from "@/lib/commercial/shopDirectoryService";
import { DIRECTORY_PAGE_SIZE_DEFAULT } from "@/lib/commercial/constants";


export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = commercialV1Route("v1.shops.list", async (req) => {
    // societyId comes from the verified token. A shopId/societyId in the query
    // string is ignored by design.
    const { societyId } = await commercialContext(req, "directoryEnabled");
    const url = new URL(req.url);
    const result = await listMemberShops({
      societyId,
      q: url.searchParams.get("q") ?? "",
      categoryId: url.searchParams.get("categoryId") || undefined,
      openNow: url.searchParams.get("openNow") === "true",
      page: Number(url.searchParams.get("page")) || 1,
      pageSize: Number(url.searchParams.get("pageSize")) || DIRECTORY_PAGE_SIZE_DEFAULT,
    });
    return json(result);
});

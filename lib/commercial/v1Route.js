// lib/commercial/v1Route.js
//
// One wrapper for every MEMBER/OWNER-facing commercial /v1 route.
//
// WHY THIS EXISTS (a real defect, not tidying):
//
// The commercial services throw `CommercialError` (lib/commercial/errors.js).
// The /v1 pipeline, `withRoute` (lib/v1/http.js), only converts `ApiError`
// into a response — anything else is logged and returned as
// `500 {"error":"Internal server error"}`. So a service that carefully threw
// `notFound()` for "this shop is not published" reached the app as a 500, and
// the app can only show "something went wrong" for a situation it should
// explain ("this shop is no longer listed", "that item just ran out").
//
// This wrapper translates CommercialError into the ApiError shape the /v1
// clients already understand, preserving the status and adding the machine
// `code` so the app can branch on OUT_OF_STOCK vs SHOP_CLOSED without parsing
// English.
//
// Composition order matters and is fixed here so no route gets it wrong:
//   withRoute( withCommercialLogging( translate( handler ) ) )
// — logging sees the real status, and withRoute still owns the DB connection.
import { withRoute, ApiError } from "@/lib/v1/http";
import { withCommercialLogging } from "./logging";
import { CommercialError } from "./errors";

function translate(handler) {
  return async (req, ctx, meta) => {
    try {
      return await handler(req, ctx, meta);
    } catch (err) {
      if (err instanceof CommercialError) {
        const body =
          err.body && typeof err.body === "object" ? { ...err.body } : { error: "Request failed" };
        // `code` is the contract the app branches on. `error` stays the
        // human sentence, already written for the person reading it.
        if (err.code) body.code = err.code;
        throw new ApiError(err.status || 400, body);
      }
      throw err;
    }
  };
}

/**
 * @param {string} operation  log label, e.g. "v1.shop.products.list"
 * @param {(req: Request, ctx: any, meta: {requestId: string}) => Promise<Response>} handler
 */
export function commercialV1Route(operation, handler) {
  return withRoute(withCommercialLogging(operation, translate(handler)));
}

/** Route params are async in this Next.js version; this keeps handlers short. */
export async function routeParams(ctx) {
  return (await ctx?.params) ?? {};
}

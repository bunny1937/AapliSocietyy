// lib/commercial/shopOwnerContext.js
//
// The one place that answers "is this caller a shop owner, and which shop?".
//
// The shop id comes from the verified token (`claims.shopId`) and from nowhere
// else. No route accepts a shop id for owner operations — that is the whole
// IDOR defence: there is no parameter to tamper with. Route files therefore
// look like `const { societyId, shopId } = await shopOwnerContext(req)` and
// cannot accidentally trust a body field.
//
// Capability, in full, matches the rule fixed in Step 1 on /v1/auth/me:
//   Commercial profile  +  claims.shopId  +  society feature flag  +  live Shop
// The first three are checked here; "live Shop" is checked by
// assertOwnedShop() in shopProductService.js, which every service call runs.
import { ApiError } from "@/lib/v1/http";
import { commercialContext } from "./v1Gate";

export async function shopOwnerContext(req) {
  // "enabled" and not "directoryEnabled": an owner must be able to manage their
  // own shop even when the society has not switched on the resident-facing
  // directory yet. That is exactly how a society sets shops up before opening
  // them to residents.
  const { claims, societyId, flags } = await commercialContext(req, "enabled");

  // No shopId in the token means the caller is on a flat profile (or has no
  // shop at all). Same 404 for both, so this cannot be used to probe whether a
  // given login owns a shop.
  if (!claims.shopId) throw new ApiError(404, "Not found");

  // A token that carries a shopId but is not the Commercial profile would mean
  // a stale/hand-made token; the resident surfaces must never reach shop
  // management.
  if (claims.kind && claims.kind !== "Commercial") {
    throw new ApiError(403, "Switch to your shop profile to manage your shop");
  }

  return {
    claims,
    flags,
    societyId,
    shopId: String(claims.shopId),
    userId: claims.userId,
  };
}

/**
 * The resident side of the same idea: a member browsing shops. The directory
 * flag gates it, because "residents can see shops" is the switch a society
 * turns on when it is ready to launch.
 */
export async function memberShopContext(req) {
  const { claims, societyId, flags } = await commercialContext(req, "directoryEnabled");
  return { claims, flags, societyId, userId: claims.userId };
}

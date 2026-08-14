import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims } from "@/lib/v1/auth";
import { User, Member, Society } from "@/lib/v1/models";
import { toMemberDto, toSocietyDto } from "@/lib/v1/authService";
import { normalizeCommercialFlags } from "@/lib/commercial/featureFlags";
import { isCommercialUnit } from "@/lib/commercial/constants";
import BusinessProfile from "@/models/BusinessProfile";
import Shop from "@/models/Shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRoute(async (req) => {
  const claims = getClaims(req, { allowMustChange: true });
  const user = await User.findById(claims.userId).select("-password -passwordHash -resetCodeHash");
  if (!user) throw new ApiError(401, "User not found");

  const [member, society] = await Promise.all([
    claims.memberId ? Member.findById(claims.memberId) : Promise.resolve(null),
    claims.societyId ? Society.findById(claims.societyId) : Promise.resolve(null),
  ]);
  // Commercial capabilities (ADDITIVE). Existing keys are untouched: the app
  // stays on the same role and the same shell. An older build ignores these
  // two booleans; a newer build uses them to show or hide the shop directory
  // without an app release.
  const commercialFlags = normalizeCommercialFlags(society?.features);
  const ownsCommercialUnit = commercialFlags.enabled && isCommercialUnit(member);
  let businessProfile = null;
  if (ownsCommercialUnit) {
    const bp = await BusinessProfile.findOne({
      societyId: claims.societyId,
      memberId: claims.memberId,
      isDeleted: { $ne: true },
    })
      .select("tradeName visibilityStatus mediaVersion logoKey")
      .lean()
      .catch(() => null);
    if (bp) {
      businessProfile = {
        id: String(bp._id),
        tradeName: bp.tradeName,
        visibilityStatus: bp.visibilityStatus,
        logoKey: bp.logoKey ?? null,
        mediaVersion: bp.mediaVersion ?? 0,
      };
    }
  }

  // Commercial profile's own unit — same role as member/society above, but
  // only fetched when the active profile is actually Commercial. Never
  // fetched by shopId from the body/query, only from verified claims.
  let shop = null;
  if (claims.kind === "Commercial" && claims.shopId) {
    shop = await Shop.findOne({ _id: claims.shopId, societyId: claims.societyId })
      .select("shopNo wing unitKind tradeName categoryId gstin areaSqft")
      .lean()
      .catch(() => null);
    if (shop) shop = { ...shop, _id: String(shop._id) };
  }

  return json({
    capabilities: {
      commercialDirectory: commercialFlags.directoryEnabled === true,
      // LEGACY capability, unchanged: it gates the old BusinessProfile editor
      // only. Left exactly as it was because that module is being retired, not
      // migrated, and changing it would alter behaviour we were asked to keep.
      manageBusinessProfile:
        ownsCommercialUnit && commercialFlags.ownerEditingEnabled === true,

      // FIXED 2026-08-14 — the shop-owner capability.
      //
      // The old rule was "owns a commercial unit", derived from the MEMBER
      // record. That is true for a resident who owns a shop even while they
      // are signed in on their HOME profile, so the app offered shop-owner
      // management from a residential session, where claims.shopId is null and
      // every shop endpoint would then 403/404 — a dead entry point.
      //
      // The correct rule is all four of:
      //   1. the ACTIVE profile is Commercial   (claims.kind)
      //   2. that profile names a shop          (claims.shopId)
      //   3. the society has owner editing on   (feature flag)
      //   4. the shop still exists and is live  (`shop` was loaded above from
      //      claims only, and is null for a deleted or cross-society id)
      manageShop:
        claims.kind === "Commercial" &&
        Boolean(claims.shopId) &&
        Boolean(shop) &&
        commercialFlags.ownerEditingEnabled === true,

      // Lets the app show the "Society Shops" entry point without a probe call.
      shopDirectory: commercialFlags.directoryEnabled === true,
    },
    businessProfile,
    user: {
      _id: String(user._id),
      username: user.username,
      email: user.email ?? null,
      role: claims.role,
      mustChangePassword: user.mustChangePassword === true,
    },
    claims: {
      userId: claims.userId,
      role: claims.role,
      societyId: claims.societyId ?? null,
      memberId: claims.memberId ?? null,
      kind: claims.kind ?? "Residential",
      shopId: claims.shopId ?? null,
      activeProfileId: claims.activeProfileId ?? null,
      occupancyType: claims.occupancyType ?? null,
    },
    member: toMemberDto(member),
    society: toSocietyDto(society),
    shop,
  });
});

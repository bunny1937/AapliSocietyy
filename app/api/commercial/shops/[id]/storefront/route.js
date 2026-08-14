// GET   /api/commercial/shops/:id/storefront -> current storefront + readiness
// PATCH /api/commercial/shops/:id/storefront -> edit the public storefront
// POST  /api/commercial/shops/:id/storefront -> publish / unpublish
//
// Publication is an ADMIN decision (approved product rule): a shop appears in
// the member "Society Shops" list only after the society publishes it. The
// owner can prepare everything, but the society controls what residents see.
//
// Everything is written onto the Shop record's `storefront` sub-document. No
// BusinessProfile is read or written here.
import { adminCommercialRoute } from "@/lib/commercial/adminRoute";
import { CommercialError, notFound } from "@/lib/commercial/errors";
import Shop from "@/models/Shop";
import { logAudit } from "@/lib/audit-logger";
import { assertCategoryUsable } from "@/lib/commercial/categoryService";
import { toShopOwnerDto } from "@/lib/commercial/shopStorefront";
import { storefrontUpdateSchema, publishSchema } from "@/lib/commercial/shopStorefrontSchemas";
import { SHOP_AUDIT_ACTIONS, PAYMENT_METHODS_BY_FULFILLMENT, FULFILLMENT_TYPES } from "@/lib/commercial/shopConstants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadShop(societyId, id) {
  // societyId is part of the query, so a shop from another society is a 404
  // and never a 403 that would confirm the id exists.
  const shop = await Shop.findOne({ _id: id, societyId, isDeleted: { $ne: true } }).catch(() => null);
  if (!shop) throw notFound();
  return shop;
}

function validationError(issues) {
  return new CommercialError(
    400,
    {
      error: "Some storefront details need attention.",
      code: "VALIDATION_ERROR",
      issues: issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    },
    "VALIDATION_ERROR",
  );
}

export const GET = adminCommercialRoute("shops.storefront.get", async ({ societyId, params }) => {
  const shop = await loadShop(societyId, params.id);
  return { shop: toShopOwnerDto(shop.toObject({ virtuals: true })) };
});

export const PATCH = adminCommercialRoute(
  "shops.storefront.update",
  async ({ req, societyId, userId, params }) => {
    const shop = await loadShop(societyId, params.id);
    const body = await req.json().catch(() => null);
    const parsed = storefrontUpdateSchema.safeParse(body ?? {});
    if (!parsed.success) throw validationError(parsed.error.issues);
    const input = parsed.data;

    const next = { ...(shop.storefront?.toObject?.() ?? shop.storefront ?? {}) };
    for (const [key, value] of Object.entries(input)) {
      next[key] = value === "" ? null : value;
    }

    // A payment method must match a fulfilment mode the shop actually offers,
    // otherwise a member would be shown "pay on delivery" by a pickup-only
    // shop and the order could not be paid for at all.
    const methods = next.offlinePaymentMethods ?? [];
    if (methods.length) {
      const allowed = new Set([
        ...(next.pickupEnabled ? PAYMENT_METHODS_BY_FULFILLMENT[FULFILLMENT_TYPES.PICKUP] : []),
        ...(next.deliveryEnabled ? PAYMENT_METHODS_BY_FULFILLMENT[FULFILLMENT_TYPES.DELIVERY] : []),
      ]);
      const invalid = methods.filter((m) => !allowed.has(m));
      if (invalid.length) {
        throw validationError([
          {
            path: ["offlinePaymentMethods"],
            message:
              "These payment methods need the matching fulfilment turned on first: " +
              invalid.join(", "),
          },
        ]);
      }
    }

    // Changing media must bust the client's image cache; otherwise a replaced
    // logo would keep showing the old picture from the device cache.
    if (input.logoKey !== undefined || input.coverKey !== undefined) {
      next.mediaVersion = Number(next.mediaVersion ?? 0) + 1;
    }
    next.updatedAt = new Date();
    next.updatedBy = userId;

    shop.storefront = next;
    await shop.save();

    await logAudit(userId, societyId, SHOP_AUDIT_ACTIONS.STOREFRONT_UPDATED, null, {
      shopId: String(shop._id),
      fields: Object.keys(input),
    });

    return { shop: toShopOwnerDto(shop.toObject({ virtuals: true })) };
  },
  { requireFlag: "enabled" },
);

export const POST = adminCommercialRoute(
  "shops.storefront.publish",
  async ({ req, societyId, userId, params }) => {
    const shop = await loadShop(societyId, params.id);
    const body = await req.json().catch(() => null);
    const parsed = publishSchema.safeParse(body ?? {});
    if (!parsed.success) throw validationError(parsed.error.issues);

    if (parsed.data.isPublished) {
      // Publishing an incomplete shop is the one thing that would make the
      // member list look broken, so readiness is enforced here, not hinted at.
      const dto = toShopOwnerDto(shop.toObject({ virtuals: true }));
      if (!dto.setup.isReadyToPublish) {
        throw new CommercialError(
          400,
          {
            error: "This shop is not ready to be listed for residents yet.",
            code: "STOREFRONT_INCOMPLETE",
            missing: dto.setup.missing,
          },
          "STOREFRONT_INCOMPLETE",
        );
      }
      if (shop.categoryId) {
        // The category must still be usable in this society: a disabled or
        // deleted category would leave the shop unreachable by the member
        // category filter.
        // Positional signature: (societyId, categoryId).
        await assertCategoryUsable(societyId, shop.categoryId);
      }
      if (shop.isActive === false) {
        throw new CommercialError(
          400,
          "Reactivate this shop before listing it for residents.",
          "SHOP_INACTIVE",
        );
      }
    }

    shop.storefront = {
      ...(shop.storefront?.toObject?.() ?? shop.storefront ?? {}),
      isPublished: parsed.data.isPublished,
      publishedAt: parsed.data.isPublished ? new Date() : null,
      publishedBy: parsed.data.isPublished ? userId : null,
      updatedAt: new Date(),
      updatedBy: userId,
    };
    await shop.save();

    await logAudit(
      userId,
      societyId,
      parsed.data.isPublished
        ? SHOP_AUDIT_ACTIONS.STOREFRONT_PUBLISHED
        : SHOP_AUDIT_ACTIONS.STOREFRONT_UNPUBLISHED,
      null,
      { shopId: String(shop._id), reason: parsed.data.reason ?? null },
    );

    return { shop: toShopOwnerDto(shop.toObject({ virtuals: true })) };
  },
  { requireFlag: "enabled" },
);

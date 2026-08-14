import { adminCommercialRoute } from "@/lib/commercial/adminRoute";
import { getShop, updateShop, deleteShop } from "@/lib/commercial/shopService";
import { autoInviteAfterSave } from "@/lib/commercial/shopOwnerInvite";

// GET    /api/commercial/shops/:id  -> one shop
// PATCH  /api/commercial/shops/:id  -> edit it
// DELETE /api/commercial/shops/:id  -> soft delete
//
// Deleting or editing a shop NEVER writes to the Member it is linked to. The
// link is a reference, not ownership of that record.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminCommercialRoute("shops.get", async ({ societyId, params }) => {
  const shop = await getShop({ societyId, id: params.id });
  return { shop };
});

export const PATCH = adminCommercialRoute(
  "shops.update",
  async ({ req, societyId, userId, params }) => {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return Response.json(
        {
          error: "The changes did not reach the server. Please try saving again.",
          code: "VALIDATION_ERROR",
        },
        { status: 400 },
      );
    }

    // Area may be edited, but not blanked — a shop with no area silently bills
    // Rs 0 on every per-sq-ft charge, which is the failure mode that started
    // all of this.
    if (body.areaSqft !== undefined && !(Number(body.areaSqft) > 0)) {
      return Response.json(
        {
          error: "The shop's area cannot be empty or zero.",
          code: "AREA_MISSING",
          issues: [
            {
              field: "areaSqft",
              message:
                "Enter the area in sq ft. If this shop should not be billed at all, switch off 'Include in billing' instead.",
            },
          ],
        },
        { status: 400 },
      );
    }

    const result = await updateShop({ societyId, userId, id: params.id, input: body });

    // Same rule as creating: an admin who links an owner expects the owner to
    // be told. This is a no-op when the owner already holds the shop profile.
    const { invite, note } = await autoInviteAfterSave({
      shopId: result.id,
      societyId,
      userId,
      savedNote: "Changes saved.",
    });

    return { id: result.id, invite, nextStep: note };
  },
  { requireFlag: "enabled" },
);

export const DELETE = adminCommercialRoute(
  "shops.delete",
  async ({ societyId, userId, params }) => {
    const result = await deleteShop({ societyId, userId, id: params.id });
    return {
      ...result,
      nextStep:
        "Shop removed from billing. Bills already generated for it are kept, and the owner's flat is untouched.",
    };
  },
  { requireFlag: "enabled" },
);

// POST /api/commercial/shops/:id/invite
//
// The manual "Invite the owner" action. As of 2026-08-15 this is only a RESEND
// / RESOLVE button: creating or editing a shop already invites the owner (see
// app/api/commercial/shops/route.js and lib/commercial/shopOwnerInvite.js).
// It stays because two cases still need an explicit human decision:
//
//   * the owner's email matches existing accounts, so the admin must choose
//     between linking one (linkUserId) or creating a separate one (createNew)
//   * the first email failed to send, or the owner deleted it
//
// All of the logic lives in lib/commercial/shopOwnerInvite.js so that this
// button and the save path can never drift apart. That duplication is exactly
// how a shop came to be linked to a member with no Commercial profile.
//
// Never writes to Member. Setting Shop.ownerUserId is the same non-destructive
// link the model already documents.
import { adminCommercialRoute } from "@/lib/commercial/adminRoute";
import { notFound } from "@/lib/commercial/errors";
import Shop from "@/models/Shop";
import { inviteShopOwner } from "@/lib/commercial/shopOwnerInvite";
import { logAudit } from "@/lib/audit-logger";
import { SHOP_AUDIT_ACTIONS } from "@/lib/commercial/shopConstants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = adminCommercialRoute(
  "shops.invite",
  async ({ req, societyId, userId, params }) => {
    const shop = await Shop.findOne({ _id: params.id, societyId, isDeleted: { $ne: true } });
    if (!shop) throw notFound();

    const body = await req.json().catch(() => ({}));
    const linkUserId = typeof body?.linkUserId === "string" ? body.linkUserId : null;
    const createNew = body?.createNew === true;

    // auto:false — this caller WANTS the 409 with candidate accounts, because
    // the admin is standing in front of the screen ready to choose.
    const result = await inviteShopOwner({
      shop,
      societyId,
      userId,
      linkUserId,
      createNew,
      auto: false,
    });

    await logAudit(userId, societyId, SHOP_AUDIT_ACTIONS.SHOP_INVITED, null, {
      shopId: String(shop._id),
      ownerUserId: result.userId,
      path: result.path,
      manual: true,
    });

    return {
      invited: result.invited,
      userId: result.userId,
      path: result.path,
      credentialsEmailSent: result.credentialsEmailSent,
      shopAddedNoticeSent: result.shopAddedNoticeSent,
      emailError: result.emailError,
      nextStep: result.alreadyAttached
        ? "The owner already had this shop on their account. The email has been sent again."
        : "The owner can now open this shop from the profile switcher in the app.",
    };
  },
  { requireFlag: "enabled" },
);

import { adminCommercialRoute } from "@/lib/commercial/adminRoute";
import { listShops, createShop } from "@/lib/commercial/shopService";
import { autoInviteAfterSave } from "@/lib/commercial/shopOwnerInvite";

// GET  /api/commercial/shops            -> every live shop in the society
// GET  /api/commercial/shops?q=103      -> search by shop no / wing / owner / trade
// GET  /api/commercial/shops?inactive=1 -> include shops switched off
// POST /api/commercial/shops            -> create a shop (NEVER touches a Member)
//
// This endpoint replaces the old "classify this unit as commercial" call, which
// overwrote Member.flatType and destroyed the flat's own type.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminCommercialRoute("shops.list", async ({ req, societyId }) => {
  const url = new URL(req.url);
  const billableOnly = url.searchParams.get("billable") === "1";
  let shops = await listShops({
    societyId,
    search: url.searchParams.get("q") ?? undefined,
    includeInactive: url.searchParams.get("inactive") === "1",
  });
  if (billableOnly) {
    shops = shops.filter((s) => s.isBillable && s.isActive && Number(s.areaSqft) > 0);
  }
  // `memberId` alias: the bill-generation wizard is shared with the residential
  // segment and keys its rows on memberId. Exposing the shop id under that name
  // lets one wizard drive both series without a fork.
  return { shops: shops.map((s) => ({ ...s, memberId: s.id })) };
});

export const POST = adminCommercialRoute(
  "shops.create",
  async ({ req, societyId, userId }) => {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return Response.json(
        {
          error: "The shop details did not reach the server. Please try saving again.",
          code: "VALIDATION_ERROR",
        },
        { status: 400 },
      );
    }

    // Only the two things a bill genuinely cannot be produced without are
    // checked up front, in plain language. Everything else is optional and can
    // be filled in later — asking for it all at once is what made the old
    // screens unusable.
    const issues = [];
    if (!String(body.shopNo ?? "").trim()) {
      issues.push({ field: "shopNo", message: "Give the shop a number, for example 103 or S-1." });
    }
    if (!String(body.ownerName ?? "").trim() && !body.ownerMemberId) {
      issues.push({
        field: "ownerName",
        message: "Either pick the owner from the members list, or type the owner's name.",
      });
    }
    if (!(Number(body.areaSqft) > 0)) {
      issues.push({
        field: "areaSqft",
        message:
          "Enter the shop's area in sq ft. Every 'per sq ft' charge is multiplied by it, so without it those charges would bill Rs 0.",
      });
    }
    if (issues.length) {
      return Response.json(
        {
          error: "Some details are still needed before this shop can be saved.",
          code: "VALIDATION_ERROR",
          issues,
        },
        { status: 400 },
      );
    }

    const result = await createShop({ societyId, userId, input: body });

    // Saving IS the invite. Requiring a second button meant shops were created
    // and their owners never invited, which is how a shop ends up linked to a
    // member who has no Commercial profile and received no email.
    const { invite, note } = await autoInviteAfterSave({
      shopId: result.id,
      societyId,
      userId,
      savedNote: "Shop saved. It will now appear in the Commercial bill run.",
    });

    return { id: result.id, invite, nextStep: note };
  },
  { requireFlag: "enabled" },
);

import { withRoute, json } from "@/lib/v1/http";
import { getClaims } from "@/lib/v1/auth";
import connectDB from "@/lib/mongodb";
import { memberContext } from "@/lib/amenities/memberContext";
import { ensureCardsForMember } from "@/lib/amenities/memberCardService";
import { Society } from "@/lib/v1/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/amenities/my-cards
//
// The resident's own Amenity Cards — one per person stored on the flat (owner
// plus every family member), which is why this returns a list and not a card.
//
// Cards are issued here, on first open, rather than by a back-fill job: nothing
// exists until the resident actually asks for it, and `issued > 0` is what tells
// the app this is the first time so it can play the reveal once and never again.
// Subsequent opens return the same cards with issued: 0.
//
// Deliberately NOT cached. This mints credentials on the first call and must
// reflect an Admin-approved name or contact change the moment it lands.
export const GET = withRoute(async (request) => {
  const claims = await getClaims(request);
  await connectDB();
  const ctx = await memberContext(claims, request);

  const [{ cards, issued }, society] = await Promise.all([
    ensureCardsForMember({
      societyId: ctx.societyId,
      memberId: ctx.memberId,
      userId: ctx.userId,
      actor: ctx.actor,
    }),
    Society.findById(ctx.societyId).select("societyName name logoUrl address city").lean(),
  ]);

  return json({
    // Branding travels with the cards so the card face is the society's, not a
    // generic template, and the app does not need a second call to render it.
    society: {
      name: society?.societyName || society?.name || "",
      logoUrl: society?.logoUrl || "",
      city: society?.city || "",
    },
    issued,
    cards: cards.map((c) => c.card),
  });
});

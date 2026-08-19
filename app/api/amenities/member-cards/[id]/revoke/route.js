import connectDB from "@/lib/mongodb";
import { z } from "zod";
import { gate, ok, fail, zodFail, isId, withAmenityRoute } from "@/lib/amenities/apiHelpers";
import { CAPABILITY } from "@/lib/amenities/permissions";
import { authorize } from "@/lib/rbac/authorize";
import { revokeCard } from "@/lib/amenities/memberCardService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  reason: z.string().trim().min(3, "Say why this card is being revoked.").max(300),
});

// POST /api/amenities/member-cards/[id]/revoke
//
// Admin-only, by decision. A revoked card stops identifying anyone at the scanner
// the moment this returns, so it is gated twice on purpose: the amenities page
// gate, plus the dedicated amenities.memberCard.revoke leaf. A custom role with
// broad amenity access still cannot revoke a resident's card unless an Admin
// granted exactly that.
//
// There is no un-revoke here. Restoring access issues a fresh credential through
// the normal path rather than resurrecting one that may have been photographed,
// shared or lost — which is the only reason a card gets revoked in the first place.
export const POST = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.VIEW_AMENITIES);
  if (!g.ok) return g.response;

  const authorized = await authorize(request, "amenities.memberCard.revoke");
  if (!authorized.ok) return authorized.response;

  const { id } = await params;
  // fail(status, message) - was backwards here (message first), which passes
  // a string where NextResponse.json expects a numeric HTTP status and
  // throws instead of returning the intended 400/404/409.
  if (!isId(id)) return fail(400, "That card reference is not valid.");

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return zodFail(parsed);

  await connectDB();

  const result = await revokeCard({
    societyId: g.societyId,
    cardId: id,
    reason: parsed.data.reason,
    actor: g.actor,
  });
  if (!result.ok) {
    return fail(
      result.reason === "NOT_FOUND" ? 404 : 409,
      result.reason === "NOT_FOUND" ? "That card no longer exists." : "This card is already revoked.",
    );
  }

  return ok({ card: result.card, message: `${result.card.holderName}'s card has been revoked.` });
});

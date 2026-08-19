import connectDB from "@/lib/mongodb";
import { z } from "zod";
import { gate, ok, fail, zodFail, isId, withAmenityRoute } from "@/lib/amenities/apiHelpers";
import { CAPABILITY } from "@/lib/amenities/permissions";
import { authorize } from "@/lib/rbac/authorize";
import { reissueCard } from "@/lib/amenities/memberCardService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

// POST /api/amenities/member-cards/[id]/reissue
//
// The office's answer to "my card's code stopped working" and to "I lost my
// phone, kill the old one." Revokes the current card (if still active) and
// mints a fresh credential for the same holder in one step — see
// memberCardService.reissueCard() for why those two are folded together.
//
// Same double gate as revoke, same permission leaf: reissuing is "manage
// member cards," not a separate capability, and a role trusted to revoke a
// resident's card is exactly the role that should be trusted to replace it.
export const POST = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.VIEW_AMENITIES);
  if (!g.ok) return g.response;

  const authorized = await authorize(request, "amenities.memberCard.revoke");
  if (!authorized.ok) return authorized.response;

  const { id } = await params;
  if (!isId(id)) return fail(400, "That card reference is not valid.");

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return zodFail(parsed);

  await connectDB();

  const result = await reissueCard({
    societyId: g.societyId,
    cardId: id,
    reason: parsed.data.reason || "Reissued from the admin card screen",
    actor: g.actor,
  });

  if (!result.ok) {
    // ALREADY_REVOKED here means a concurrent revoke won the race between
    // this route's own lookup and its revoke step — surfaced as a plain
    // failure so the office clicks reissue again, rather than this route
    // silently deciding whether that race was safe to paper over.
    const messages = {
      NOT_FOUND: ["That card no longer exists.", 404],
      MEMBER_NOT_FOUND: ["The resident this card belongs to could not be found.", 404],
      HOLDER_NO_LONGER_ON_RECORD: [
        "This card holder is no longer on the flat's record (e.g. a removed family member). Nothing to reissue to.",
        409,
      ],
      ALREADY_REVOKED: ["This card was just revoked by someone else — try reissuing again.", 409],
    };
    const [message, status] = messages[result.reason] || ["Could not reissue this card.", 500];
    return fail(status, message);
  }

  return ok({ card: result.card, message: `A new card has been issued for ${result.card.holderName}.` });
});

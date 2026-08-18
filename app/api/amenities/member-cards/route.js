import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import AmenityMemberCard from "@/models/amenities/AmenityMemberCard";
import Member from "@/models/Member";
import { gate, ok, fail, paging, pageMeta, withAmenityRoute } from "@/lib/amenities/apiHelpers";
import { CAPABILITY } from "@/lib/amenities/permissions";
import { adminCardView } from "@/lib/amenities/memberCardService";
import { MEMBER_CARD_STATUS } from "@/lib/amenities/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/amenities/member-cards?q=&status=&page=&limit=
//
// Admin custody of the digital cards. This is the "retrieve / identify the card
// when necessary" side of the locked decision — an Admin can find a card by
// number, by resident, or by flat, and see whether it is live.
//
// It never returns the credential. The token is stored hashed and cannot be read
// back here even in principle; adminCardView() projects only identity, issue
// date and scan history. Identification is by cardNo, which is derived from the
// card id and safe to print, read out over a phone, or search on.
export const GET = withAmenityRoute(async (request) => {
  const g = await gate(request, CAPABILITY.VIEW_AMENITIES);
  if (!g.ok) return g.response;
  await connectDB();

  const sp = new URL(request.url).searchParams;
  const { page, limit, skip } = paging(sp);
  const q = sp.get("q")?.trim();
  const status = sp.get("status");

  const filter = { societyId: g.societyId };
  if (status && Object.values(MEMBER_CARD_STATUS).includes(status)) filter.status = status;
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ holderName: rx }, { flatNo: rx }, { wing: rx }, { cardNo: rx }, { contactNumber: rx }];
  }

  const [rows, total, counts] = await Promise.all([
    AmenityMemberCard.find(filter)
      // Grouped by flat so a household's cards read together, which is how an
      // Admin is asked about them ("the Sharmas in A-1204").
      .sort({ wing: 1, flatNo: 1, holderKind: 1, familyIndex: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AmenityMemberCard.countDocuments(filter),
    AmenityMemberCard.aggregate([
      { $match: { societyId: g.societyId } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  const byStatus = counts.reduce((acc, c) => ({ ...acc, [c._id]: c.count }), {});

  // Households with no card yet are not an error state: cards materialise the
  // first time a resident opens My Amenity Cards. Reporting the number tells an
  // Admin what they are looking at instead of leaving a gap unexplained.
  const [membersTotal, membersWithCards] = await Promise.all([
    Member.countDocuments({ societyId: g.societyId, isActive: true }),
    AmenityMemberCard.distinct("memberId", { societyId: g.societyId }),
  ]);

  return ok({
    cards: rows.map(adminCardView),
    counts: {
      active: byStatus[MEMBER_CARD_STATUS.ACTIVE] || 0,
      revoked: byStatus[MEMBER_CARD_STATUS.REVOKED] || 0,
      flatsWithCards: membersWithCards.length,
      flatsTotal: membersTotal,
    },
    ...pageMeta({ page, limit, total }),
  });
});

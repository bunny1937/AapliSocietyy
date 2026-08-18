import { withRoute, json } from "@/lib/v1/http";
import connectDB from "@/lib/mongodb";
import { z } from "zod";
import Amenity from "@/models/amenities/Amenity";
import AmenityAttendance from "@/models/amenities/AmenityAttendance";
import { clubhouseContext } from "@/lib/amenities/clubhouseContext";
import { CAPABILITY, checkEligibility } from "@/lib/amenities/permissions";
import { verifyCard, noteCardScanned } from "@/lib/amenities/memberCardService";
import { capacitySnapshot } from "@/lib/amenities/attendanceService";
import { resolveEffectiveStatus } from "@/lib/amenities/availability";
import { getTimezone } from "@/lib/amenities/settingsService";
import { ageFrom } from "@/lib/amenities/memberContext";
import { CARD_RESULT } from "@/lib/amenities/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  payload: z.string().min(6, "Scan a valid amenity card"),
  // Optional: when the manager re-scans from inside an amenity sheet, the
  // amenity is already chosen and the response can lead with its slots.
  amenityId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
});

const REFUSAL = {
  [CARD_RESULT.INVALID_CARD]: "This card is invalid or no longer active.",
  [CARD_RESULT.WRONG_SOCIETY]: "This card is invalid or no longer active.",
  [CARD_RESULT.REVOKED]: "This card is invalid or no longer active.",
  [CARD_RESULT.MEMBER_INACTIVE]: "Member could not be verified.",
};

// POST /api/v1/clubhouse/scan
//
// STEP 1 of the locked flow: identify. This endpoint answers "who is standing in
// front of me, and are they already inside?" — it writes no attendance and
// starts no session. Check-in is a separate, deliberate act (see ./check-in).
//
// Splitting identify from check-in is what makes the desk flow honest: the
// manager sees the resident's name and flat, confirms it against the person in
// front of them, and only then picks an amenity and a slot.
export const POST = withRoute(async (request) => {
  const ctx = await clubhouseContext(request, CAPABILITY.SCAN_QR);
  await connectDB();

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return json({ error: parsed.error.flatten() }, { status: 400 });

  const verification = await verifyCard({ societyId: ctx.societyId, raw: parsed.data.payload });

  if (!verification.ok) {
    // 200 with ok:false, not a 4xx: a refused card is a normal outcome at a
    // busy desk, and the scanner screen needs to render the reason and keep
    // scanning rather than treat it as a transport failure.
    return json({
      ok: false,
      result: verification.result,
      message: REFUSAL[verification.result] || "This card is invalid or no longer active.",
    });
  }

  const { card, member } = verification;
  await noteCardScanned(card._id);

  // Which holder on the flat this specific card belongs to. A flat's three cards
  // are three different people, and the wrong name on screen would defeat the
  // point of showing one at all.
  const holderAge =
    card.holderKind === "OWNER"
      ? ageFrom(member.dateOfBirth)
      : member.familyMembers?.[card.familyIndex]?.age ?? null;

  const [amenities, timezone, openSessions] = await Promise.all([
    Amenity.find({ societyId: ctx.societyId, isDeleted: false, isActive: true })
      .select("name categoryId status capacity liveOccupancy openingTime closingTime operatingDays access slotPolicy attendanceMode activeMaintenanceId")
      .sort({ displayOrder: 1, name: 1 })
      .lean(),
    getTimezone(ctx.societyId),
    // "Inside / Outside" for the member header, and the reason the app can offer
    // Check out instead of Check in without a second round trip.
    AmenityAttendance.find({ memberId: member._id, timeOut: null })
      .select("amenityId amenityName timeIn slotLabel")
      .lean(),
  ]);

  const insideByAmenity = new Map(openSessions.map((s) => [String(s.amenityId), s]));

  const usable = await Promise.all(
    amenities.map(async (a) => {
      const effective = await resolveEffectiveStatus({ amenity: a, timezone });
      // The same eligibility rules the resident's own check-in runs, evaluated
      // for the card holder rather than for the manager holding the phone.
      const eligibility = checkEligibility({
        amenity: a,
        occupancyType: member.occupancyType,
        role: "Member",
        age: holderAge,
      });
      const capacity = capacitySnapshot(a);
      const inside = insideByAmenity.get(String(a._id));
      return {
        _id: a._id,
        name: a.name,
        categoryId: a.categoryId,
        status: a.status,
        effective,
        capacity,
        openingTime: a.openingTime,
        closingTime: a.closingTime,
        slotsEnabled: !!a.slotPolicy?.enabled,
        eligible: eligibility.allowed,
        eligibilityReason: eligibility.allowed ? "" : eligibility.reason,
        alreadyInside: !!inside,
        openSessionId: inside?._id || null,
      };
    }),
  );

  return json({
    ok: true,
    result: CARD_RESULT.VALID,
    member: {
      memberId: member._id,
      cardId: card._id,
      cardNo: card.cardNo,
      name: card.holderName,
      relation: card.relation,
      holderKind: card.holderKind,
      flatNo: card.flatNo,
      wing: card.wing,
      flatLabel: [card.wing, card.flatNo].filter(Boolean).join("-") || card.flatNo,
      contactNumber: card.contactNumber,
      age: holderAge,
      // Inside/Outside at the society level: the header states it once, and the
      // per-amenity rows below say where.
      isInside: openSessions.length > 0,
      openSessions: openSessions.map((s) => ({
        attendanceId: s._id,
        amenityId: s.amenityId,
        amenityName: s.amenityName,
        slotLabel: s.slotLabel || "",
        timeIn: s.timeIn,
      })),
    },
    amenities: parsed.data.amenityId
      ? usable.filter((a) => String(a._id) === parsed.data.amenityId)
      : usable,
  });
});

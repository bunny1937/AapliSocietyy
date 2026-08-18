import { withRoute, json } from "@/lib/v1/http";
import connectDB from "@/lib/mongodb";
import { z } from "zod";
import Amenity from "@/models/amenities/Amenity";
import AmenityTimeSlot from "@/models/amenities/AmenityTimeSlot";
import { clubhouseContext } from "@/lib/amenities/clubhouseContext";
import { CAPABILITY } from "@/lib/amenities/permissions";
import { verifyCard } from "@/lib/amenities/memberCardService";
import { checkIn, CheckInError } from "@/lib/amenities/attendanceService";
import { STATUS_BY_CODE } from "@/lib/amenities/apiHelpers";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { notifyCheckedInByStaff } from "@/lib/amenities/notify";
import { ageFrom } from "@/lib/amenities/memberContext";
import { Member } from "@/lib/v1/models";
import {
  ACTIVITY_ACTION,
  ATTENDEE_TYPE,
  CHECKIN_METHOD,
  CARD_RESULT,
} from "@/lib/amenities/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  // The card is re-presented rather than a memberId being trusted from the scan
  // response: this is the write, and the credential is what authorises it. A
  // client that could check anyone in by posting an id would make the card
  // decorative.
  payload: z.string().min(6, "Scan a valid amenity card"),
  amenityId: z.string().regex(/^[a-f\d]{24}$/i, "Select an amenity"),
  slotId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
});

// Messages are fixed strings owned by the server, so the desk sees the same
// wording every time and the app never has to invent one.
const CODE_MESSAGE = {
  ALREADY_CHECKED_IN: "This member is already checked in.",
  CAPACITY_FULL: "This amenity is currently full.",
  AMENITY_CLOSED: "This amenity is currently closed.",
  OUTSIDE_HOURS: "This amenity is currently closed.",
  NOT_ELIGIBLE: "Member could not be verified.",
  NOT_FOUND: "Member could not be verified.",
};

// POST /api/v1/clubhouse/check-in
//
// STEP 5 of the locked flow: confirm. The last step, and the only one that
// writes.
//
// Every rule that governs a check-in — opening hours, maintenance, status,
// capacity claim, duplicate open session, eligibility — lives in
// attendanceService.checkIn() and is NOT re-implemented here or in Flutter.
// This route's whole job is: prove the card, resolve the holder, name the actor,
// hand it to the service, and notify the resident if (and only if) the service
// says it happened.
export const POST = withRoute(async (request) => {
  const ctx = await clubhouseContext(request, CAPABILITY.RECORD_ATTENDANCE);
  await connectDB();

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return json({ error: parsed.error.flatten() }, { status: 400 });
  const { payload, amenityId, slotId } = parsed.data;

  const verification = await verifyCard({ societyId: ctx.societyId, raw: payload });
  if (!verification.ok) {
    return json(
      {
        ok: false,
        code: verification.result,
        message:
          verification.result === CARD_RESULT.MEMBER_INACTIVE
            ? "Member could not be verified."
            : "This card is invalid or no longer active.",
      },
      { status: verification.result === CARD_RESULT.REVOKED ? 410 : 400 },
    );
  }
  const { card, member } = verification;

  const amenity = await Amenity.findOne({
    _id: amenityId,
    societyId: ctx.societyId,
    isDeleted: false,
  }).lean();
  if (!amenity) return json({ ok: false, code: "NOT_FOUND", message: "Member could not be verified." }, { status: 404 });

  // A slot passed from the app is validated against this amenity before use:
  // a stale slot id from a previous selection must not attach a session to the
  // wrong window.
  let slot = null;
  if (slotId) {
    slot = await AmenityTimeSlot.findOne({ _id: slotId, amenityId, isActive: true }).lean();
    if (!slot) {
      return json({ ok: false, code: "SLOT_NOT_FOUND", message: "No available slot is currently available." }, { status: 409 });
    }
  }

  const holderAge =
    card.holderKind === "OWNER"
      ? ageFrom(member.dateOfBirth)
      : member.familyMembers?.[card.familyIndex]?.age ?? null;

  try {
    const result = await checkIn({
      societyId: ctx.societyId,
      amenity,
      attendeeType: ATTENDEE_TYPE.RESIDENT,
      memberId: member._id,
      // The card holder's own account when they have one; a family member
      // without a login is still a real attendee, recorded by name.
      userId: card.userId || null,
      residentName: card.holderName,
      flatNo: [card.wing, card.flatNo].filter(Boolean).join("-") || card.flatNo,
      occupancyType: member.occupancyType,
      age: holderAge,
      method: CHECKIN_METHOD.QR,
      // Explicitly NOT an override: the manager is operating the desk within the
      // rules, not overruling them. Overrides stay an Admin act with a reason.
      isOverride: false,
      slotId: slot?._id || null,
      checkedInBy: ctx.userId,
      checkedInByName: ctx.name,
      checkedInByRole: "Clubhouse Manager",
      actor: ctx.actor,
    });

    await logAmenityActivity({
      societyId: ctx.societyId,
      entityType: "ATTENDANCE",
      entityId: result.attendance._id,
      amenityId: amenity._id,
      amenityName: amenity.name,
      action: ACTIVITY_ACTION.ATTENDANCE_CHECK_IN,
      actor: ctx.actor,
      newValue: {
        member: card.holderName,
        flat: [card.wing, card.flatNo].filter(Boolean).join("-"),
        cardNo: card.cardNo,
        slotLabel: result.attendance.slotLabel || "",
        via: "CLUBHOUSE_SCAN",
      },
      note: `Scanned in by ${ctx.name || "Clubhouse Manager"}`,
    });

    // AFTER the write, and only on success. safeNotify inside notify.js means a
    // push failure cannot roll back a check-in that really happened.
    if (card.userId) {
      await notifyCheckedInByStaff({
        societyId: ctx.societyId,
        userId: card.userId,
        amenity,
        slotLabel: result.attendance.slotLabel || "",
        byName: ctx.name,
        at: result.attendance.timeIn,
      });
    }

    return json({
      ok: true,
      attendance: {
        _id: result.attendance._id,
        amenityId: amenity._id,
        amenityName: amenity.name,
        memberName: card.holderName,
        flatLabel: [card.wing, card.flatNo].filter(Boolean).join("-") || card.flatNo,
        slotLabel: result.attendance.slotLabel || "",
        timeIn: result.attendance.timeIn,
      },
      capacity: result.capacity,
      notified: !!card.userId,
    });
  } catch (err) {
    if (err instanceof CheckInError) {
      // The service already released any capacity it claimed. Reuse its own
      // status mapping rather than inventing a second one.
      return json(
        {
          ok: false,
          code: err.code,
          message: CODE_MESSAGE[err.code] || err.message,
          ...(err.meta ? { meta: err.meta } : {}),
        },
        { status: STATUS_BY_CODE[err.code] || 409 },
      );
    }
    throw err;
  }
});

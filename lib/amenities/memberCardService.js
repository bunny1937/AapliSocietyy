import crypto from "crypto";
import AmenityMemberCard from "@/models/amenities/AmenityMemberCard";
import { Member as V1Member } from "@/lib/v1/models";
import {
  CARD_RESULT,
  CARD_HOLDER_KIND,
  MEMBER_CARD_STATUS,
  ACTIVITY_ACTION,
} from "./constants";
import { logAmenityActivity } from "./activityLog";

// Issuing and validating the resident Amenity Card.
//
// Payload format:  AMC1:<memberId>:<prefix>:<secret>
//   AMC1        version tag, and the thing that makes a card unmistakably NOT
//               an amenity sticker (those are AMN1). The scan endpoint refuses
//               the wrong kind outright rather than guessing.
//   memberId    lets the app render the flat instantly; NEVER trusted for
//               authorisation — the server resolves the holder from the stored
//               card row, exactly as qrService does.
//   prefix      indexed lookup key
//   secret      the only part that is hashed and verified
//
// Deliberately the same shape, the same hashing and the same constant-time
// compare as lib/amenities/qrService.js. Two credential formats in one module
// that behave differently under attack would be the actual risk here.

const PREFIX_LEN = 10;

function hashSecret(secret) {
  return crypto.createHash("sha256").update(String(secret)).digest("hex");
}

// "AS-4F2C-8B91" — something a resident can read out over the phone to the
// office and an Admin can paste into the card search. Derived from the prefix,
// so it identifies without authorising.
function cardNoFrom(prefix) {
  const up = String(prefix).toUpperCase();
  return `AS-${up.slice(0, 4)}-${up.slice(4, 8)}`;
}

export function parseCardPayload(raw) {
  if (typeof raw !== "string") return null;
  let value = raw.trim();

  // Accept the deep-link form as well, so a phone camera that opens the URL
  // instead of handing the string to the in-app scanner still resolves.
  const linkMatch = value.match(/[?&]c=([^&\s]+)/);
  if (linkMatch) value = decodeURIComponent(linkMatch[1]);

  const parts = value.split(":");
  if (parts.length !== 4 || parts[0] !== "AMC1") return null;
  const [, memberId, prefix, secret] = parts;
  if (!/^[a-f\d]{24}$/i.test(memberId) || !prefix || !secret) return null;
  return { version: "AMC1", memberId, prefix, secret, raw: value };
}

// The card face. Everything a card needs to render and nothing else: no PAN, no
// Aadhaar, no email, no date of birth, no occupancy type, no financial state.
function cardFace(doc, token = null) {
  return {
    _id: doc._id,
    cardNo: doc.cardNo,
    holderKind: doc.holderKind,
    holderName: doc.holderName,
    relation: doc.relation || "",
    flatNo: doc.flatNo,
    wing: doc.wing || "",
    flatLabel: [doc.wing, doc.flatNo].filter(Boolean).join("-") || doc.flatNo || "",
    contactNumber: doc.contactNumber || "",
    status: doc.status,
    issuedAt: doc.issuedAt,
    // Present only for the card's own holder reading their own cards. The admin
    // card screen calls this without a token and therefore cannot clone a card.
    ...(token ? { qrPayload: token } : {}),
  };
}

// The holders a flat currently has: the owner, plus every stored family member.
// This is read straight off the existing Member document — there is no second
// family system, and no eligibility flag to satisfy.
function holdersOf(member) {
  const flat = { flatNo: member.flatNo || "", wing: member.wing || "" };
  const holders = [
    {
      holderKind: CARD_HOLDER_KIND.OWNER,
      familyIndex: null,
      holderName: member.ownerName || "",
      relation: "Owner",
      contactNumber: member.contactNumber || "",
      ...flat,
    },
  ];
  (member.familyMembers || []).forEach((fm, index) => {
    if (!fm?.name) return; // a blank row in the family list is not a person
    holders.push({
      holderKind: CARD_HOLDER_KIND.FAMILY,
      familyIndex: index,
      holderName: fm.name,
      relation: fm.relation || "Family",
      contactNumber: fm.contactNumber || "",
      ...flat,
    });
  });
  return holders;
}

// Mint one card. Returns { doc, token } — token is the plaintext payload, which
// is generated here and never stored.
async function issueCard({ societyId, memberId, userId, holder, actor }) {
  const secret = crypto.randomBytes(24).toString("base64url");
  const prefix = crypto.randomBytes(8).toString("hex").slice(0, PREFIX_LEN);
  const token = `AMC1:${memberId}:${prefix}:${secret}`;

  const doc = await AmenityMemberCard.create({
    societyId,
    memberId,
    userId: userId || null,
    holderKind: holder.holderKind,
    familyIndex: holder.familyIndex,
    holderName: holder.holderName,
    relation: holder.relation,
    flatNo: holder.flatNo,
    wing: holder.wing,
    contactNumber: holder.contactNumber,
    tokenHash: hashSecret(secret),
    tokenPrefix: prefix,
    cardNo: cardNoFrom(prefix),
    status: MEMBER_CARD_STATUS.ACTIVE,
    issuedAt: new Date(),
  });

  await logAmenityActivity({
    societyId,
    entityType: "MEMBER_CARD",
    entityId: doc._id,
    action: ACTIVITY_ACTION.MEMBER_CARD_ISSUED,
    actor,
    newValue: {
      cardNo: doc.cardNo,
      holderName: doc.holderName,
      holderKind: doc.holderKind,
      flat: [doc.wing, doc.flatNo].filter(Boolean).join("-"),
    },
  });

  return { doc, token };
}

// Keep the card face in step with the Member record.
//
// This is how "cards automatically reflect approved changes" is honoured: the
// existing profile-edit-request flow already writes approved changes onto the
// Member document, and the next read of the cards refreshes the denormalised
// face from it. No separate card-edit workflow, and nothing for a resident to
// re-request.
async function syncCard(doc, holder) {
  const changed =
    doc.holderName !== holder.holderName ||
    (doc.relation || "") !== (holder.relation || "") ||
    (doc.flatNo || "") !== (holder.flatNo || "") ||
    (doc.wing || "") !== (holder.wing || "") ||
    (doc.contactNumber || "") !== (holder.contactNumber || "");
  if (!changed) return doc;

  // Not logged as a card event: the change was already approved and audited by
  // the profile-edit-request flow that caused it. Logging it again here would
  // report an edit the card holder never made.
  return AmenityMemberCard.findByIdAndUpdate(
    doc._id,
    {
      $set: {
        holderName: holder.holderName,
        relation: holder.relation,
        flatNo: holder.flatNo,
        wing: holder.wing,
        contactNumber: holder.contactNumber,
      },
    },
    { new: true },
  ).lean();
}

/**
 * Every card for a flat, generating any that do not exist yet.
 *
 * Called when the resident opens "My Amenity Cards". Generation-on-first-open
 * (rather than a migration that back-fills every member of every society) means
 * a card exists exactly when someone actually wants one, and the app has a
 * genuine moment to play its one-time reveal animation against.
 *
 * Idempotent: the unique (memberId, holderKind, familyIndex) index turns a
 * concurrent second call into a duplicate-key error that is caught and read
 * back, so two devices cannot mint two credentials for the same person.
 */
export async function ensureCardsForMember({ societyId, memberId, userId, actor }) {
  const member = await V1Member.findOne({ _id: memberId, societyId })
    .select("_id ownerName flatNo wing contactNumber familyMembers isActive")
    .lean();
  if (!member) return { cards: [], issued: 0 };

  const holders = holdersOf(member);
  const existing = await AmenityMemberCard.find({ memberId }).lean();
  const byKey = new Map(
    existing.map((c) => [`${c.holderKind}:${c.familyIndex ?? "-"}`, c]),
  );

  const out = [];
  let issued = 0;

  for (const holder of holders) {
    const key = `${holder.holderKind}:${holder.familyIndex ?? "-"}`;
    const found = byKey.get(key);

    if (found) {
      const synced = await syncCard(found, holder);
      // No plaintext token: the secret was never stored, so an existing card is
      // re-displayed from the payload the app cached when it was issued. The
      // app persists it per card id for exactly this reason.
      out.push({ card: cardFace(synced), token: null });
      continue;
    }

    try {
      const { doc, token } = await issueCard({ societyId, memberId, userId, holder, actor });
      issued += 1;
      out.push({ card: cardFace(doc, token), token, isNew: true });
    } catch (err) {
      if (err?.code === 11000) {
        const raced = await AmenityMemberCard.findOne({
          memberId,
          holderKind: holder.holderKind,
          familyIndex: holder.familyIndex,
        }).lean();
        if (raced) out.push({ card: cardFace(raced), token: null });
        continue;
      }
      throw err;
    }
  }

  return { cards: out, issued };
}

/**
 * Validate a scanned card. Returns a CARD_RESULT rather than throwing, so the
 * scan endpoint can record and explain every outcome, including refusals.
 */
export async function verifyCard({ societyId, raw }) {
  const parsed = parseCardPayload(raw);
  if (!parsed) return { ok: false, result: CARD_RESULT.INVALID_CARD, card: null, parsed: null };

  const card = await AmenityMemberCard.findOne({ tokenPrefix: parsed.prefix }).lean();
  if (!card) return { ok: false, result: CARD_RESULT.INVALID_CARD, card: null, parsed };

  // Constant-time compare: an early-exit compare leaks information about the
  // stored hash across repeated attempts.
  const candidate = Buffer.from(hashSecret(parsed.secret));
  const stored = Buffer.from(card.tokenHash);
  const matches =
    candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
  if (!matches) return { ok: false, result: CARD_RESULT.INVALID_CARD, card, parsed };

  // A genuine secret presented under a different memberId is a forgery attempt,
  // not a typo — refuse it rather than helpfully resolving the real holder.
  if (String(card.memberId) !== String(parsed.memberId)) {
    return { ok: false, result: CARD_RESULT.INVALID_CARD, card, parsed };
  }
  // A card photographed in one society must not work in another.
  if (String(card.societyId) !== String(societyId)) {
    return { ok: false, result: CARD_RESULT.WRONG_SOCIETY, card, parsed };
  }
  if (card.status !== MEMBER_CARD_STATUS.ACTIVE || card.revokedAt) {
    return { ok: false, result: CARD_RESULT.REVOKED, card, parsed };
  }

  const member = await V1Member.findOne({ _id: card.memberId, societyId })
    .select("_id ownerName flatNo wing occupancyType dateOfBirth isActive familyMembers")
    .lean();
  if (!member || member.isActive === false) {
    return { ok: false, result: CARD_RESULT.MEMBER_INACTIVE, card, parsed, member: null };
  }

  return { ok: true, result: CARD_RESULT.VALID, card, parsed, member };
}

// Counters are advanced on a successful scan only, and never block the scan:
// a failed counter write must not cost a resident their check-in.
export async function noteCardScanned(cardId) {
  try {
    await AmenityMemberCard.findByIdAndUpdate(cardId, {
      $inc: { scanCount: 1 },
      $set: { lastScannedAt: new Date() },
    });
  } catch (err) {
    console.error("[amenities] card scan counter failed", err?.message);
  }
}

/**
 * Revoke a card. Admin-only — enforced at the route, which is the only caller.
 *
 * Idempotent in the same way qrService.revokeToken is: re-revoking must not move
 * revokedAt forward, or a second click rewrites the record of when the card
 * actually stopped working.
 */
export async function revokeCard({ societyId, cardId, reason, actor }) {
  const current = await AmenityMemberCard.findOne({ _id: cardId, societyId }).lean();
  if (!current) return null;
  if (current.status !== MEMBER_CARD_STATUS.ACTIVE) return current;

  const updated = await AmenityMemberCard.findByIdAndUpdate(
    cardId,
    {
      $set: {
        status: MEMBER_CARD_STATUS.REVOKED,
        revokedAt: new Date(),
        revokedBy: actor?.userId || null,
        revokeReason: reason || "",
      },
    },
    { new: true },
  ).lean();

  await logAmenityActivity({
    societyId,
    entityType: "MEMBER_CARD",
    entityId: cardId,
    action: ACTIVITY_ACTION.MEMBER_CARD_REVOKED,
    actor,
    oldValue: { status: current.status },
    newValue: { status: MEMBER_CARD_STATUS.REVOKED, cardNo: current.cardNo, reason: reason || "" },
    changedFields: ["status"],
    note: `Card ${current.cardNo} (${current.holderName}) revoked`,
  });

  return updated;
}

// Admin-facing projection: identify a card, never clone it. No tokenHash, no
// payload, no secret — by omission, not by filtering downstream.
export function adminCardView(doc) {
  return {
    _id: doc._id,
    cardNo: doc.cardNo,
    holderName: doc.holderName,
    holderKind: doc.holderKind,
    relation: doc.relation || "",
    flatLabel: [doc.wing, doc.flatNo].filter(Boolean).join("-") || doc.flatNo || "",
    contactNumber: doc.contactNumber || "",
    status: doc.status,
    issuedAt: doc.issuedAt,
    revokedAt: doc.revokedAt,
    revokeReason: doc.revokeReason || "",
    scanCount: doc.scanCount || 0,
    lastScannedAt: doc.lastScannedAt,
    memberId: doc.memberId,
  };
}

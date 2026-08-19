import mongoose from "mongoose";
import {
  MEMBER_CARD_STATUSES,
  MEMBER_CARD_STATUS,
  CARD_HOLDER_KINDS,
  CARD_HOLDER_KIND,
} from "@/lib/amenities/constants";

// amenity_member_cards — the resident's Digital Amenity Card credential.
//
// WHY THIS IS NOT AmenityQrToken
// AmenityQrToken was inspected first and cannot hold this: it requires
// `amenityId` (a card belongs to a PERSON, not to the pool), its partial unique
// index is (amenityId, mode, isActive), and its whole model is a sticker on a
// door that an admin regenerates and revokes. A card is the opposite: one per
// resident, permanent, never regenerated. Forcing one collection to be both
// would have meant a fake amenityId on every card row and an index that no
// longer means what it says. Everything else is deliberately borrowed from that
// model instead of reinvented — hash-only storage, short indexed prefix,
// revocation stamps, scan counters.
//
// One row per card-holder, not per flat: Flat A-1204 with an owner, a spouse and
// a child is three rows. There is no cap and no eligibility flag — every stored
// owner/family member gets a card, which is why holder identity is (memberId +
// holderKind + familyIndex) rather than a separate eligibility document.
//
// A SHA-256 hash of the secret is stored for fast-path scan verification
// (unchanged), AND an encrypted copy (tokenEnc, lib/amenities/cardCrypto.js)
// so the server can hand the plaintext back to the card's own holder on every
// load — no client-side-only caching, no permanently-dead QR after a
// reinstall. The admin card screen still never reads tokenEnc; it identifies
// a card without ever displaying or cloning one.
const AmenityMemberCardSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: "Member", required: true, index: true },
    // The account that can display this card in the app. Null for a family
    // member who has no login of their own — their card lives in the flat's
    // account, which is exactly how the family list already works.
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    holderKind: { type: String, enum: CARD_HOLDER_KINDS, default: CARD_HOLDER_KIND.OWNER },
    // Index into Member.familyMembers[] for a FAMILY card. Kept as the identity
    // rather than a copy of the name so a corrected spelling does not orphan a
    // card and silently mint a second one.
    familyIndex: { type: Number, default: null },

    // Denormalised for the card face and for the manager's scan result, so
    // showing a card never needs a second read. Refreshed from the Member record
    // whenever an Admin-approved change lands (see memberCardService.syncCard).
    holderName: { type: String, trim: true, maxlength: 120, default: "" },
    relation: { type: String, trim: true, maxlength: 40, default: "" },
    flatNo: { type: String, trim: true, maxlength: 30, default: "" },
    wing: { type: String, trim: true, maxlength: 20, default: "" },
    contactNumber: { type: String, trim: true, maxlength: 20, default: "" },

    tokenHash: { type: String, required: true, index: true },
    // Reversible copy for re-display (lib/amenities/cardCrypto.js). Nullable:
    // cards issued before this field existed have none and are transparently
    // reissued the next time their holder opens My Amenity Cards - see
    // memberCardService.ensureCardsForMember(). tokenHash keeps doing what it
    // always did; this is additive, not a replacement.
    tokenEnc: { type: String, default: null },
    // Short, non-secret fragment carried in the payload so verification is an
    // index hit instead of a hash scan across the society.
    tokenPrefix: { type: String, required: true, index: true },
    // Human-quotable card number for the Admin screen ("which card is this?"),
    // derived from the prefix. Not a credential on its own — knowing it does
    // not let anyone check in.
    cardNo: { type: String, index: true },

    status: { type: String, enum: MEMBER_CARD_STATUSES, default: MEMBER_CARD_STATUS.ACTIVE, index: true },
    issuedAt: { type: Date, default: Date.now },
    // No expiresAt. Cards are permanent by decision; revocation is the only end.
    revokedAt: { type: Date, default: null },
    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    revokeReason: { type: String, trim: true, maxlength: 300, default: "" },

    scanCount: { type: Number, default: 0 },
    lastScannedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// One ACTIVE card per holder. Partial on status: ACTIVE, not a bare unique
// index — a revoked card and its replacement legitimately share the same
// identity tuple (memberId, holderKind, familyIndex), and a bare unique index
// made every legacy-card auto-heal and every admin reissue permanently fail.
// The revoke step never changes those three fields, so the just-revoked row
// kept the index slot occupied and the mint-replacement insert collided with
// it on every single attempt - not a race, a guaranteed E11000 every time for
// any member whose card predates encrypted storage. This still makes
// "generate on first open" race-safe for two concurrent first-opens (both
// insert with status ACTIVE, one wins the partial-unique slot, the loser's
// catch re-fetches the winner) without blocking revoke-then-reissue.
AmenityMemberCardSchema.index(
  { memberId: 1, holderKind: 1, familyIndex: 1 },
  { unique: true, partialFilterExpression: { status: MEMBER_CARD_STATUS.ACTIVE } },
);
AmenityMemberCardSchema.index({ societyId: 1, status: 1, createdAt: -1 });

export default mongoose.models.AmenityMemberCard ||
  mongoose.model("AmenityMemberCard", AmenityMemberCardSchema, "amenity_member_cards");

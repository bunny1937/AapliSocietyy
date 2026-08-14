// Token issuance for the /v1 auth flow. Ported from mobile-backend
// src/modules/auth/auth.controller.ts issueTokens() + its DTO helpers.
import { randomUUID } from "node:crypto";
import { signAccess, signRefresh, refreshExpiresAt } from "./jwt";
import { RefreshToken } from "./models";
import { OCCUPANCY_TYPES } from "./constants";

// Builds JWT claims from the user + selected profile, mints a rotating
// refresh token (persisted for revocation), and returns the login/refresh
// response shape the Flutter client expects: { role, mustChangePassword,
// tokens: { accessToken, refreshToken } }.
export async function issueTokens(user, profile) {
  const jti = randomUUID();
  const claims = {
    userId: String(user._id),
    role: profile?.role ?? user.role,
    societyId: profile?.societyId ? String(profile.societyId) : undefined,
    memberId: profile?.memberId ? String(profile.memberId) : undefined,
    kind: profile?.kind ?? "Residential",
    shopId: profile?.shopId ? String(profile.shopId) : undefined,
    // Web User profiles use `profileId` (auto ObjectId); guard for staff
    // accounts whose fallback profile has neither profileId nor _id.
    activeProfileId: profile?.profileId
      ? String(profile.profileId)
      : profile?._id
        ? String(profile._id)
        : undefined,
    occupancyType: profile?.occupancyType ?? OCCUPANCY_TYPES.OWNER,
    mustChangePassword: user.mustChangePassword === true || undefined,
    // Shared with the refresh token below so /v1/auth/logout's
    // revoked:jti:<jti> denylist (middleware.js reads it on every request)
    // actually has something to revoke — access tokens didn't carry a jti
    // before this, so logout silently revoked nothing for mobile clients.
    jti,
  };
  // Carry the active profile in the refresh token so /auth/refresh can
  // re-scope the rotated access token to the same profile statelessly.
  const refreshToken = signRefresh({ userId: String(user._id), jti, profileId: claims.activeProfileId });
  await RefreshToken.create({ userId: user._id, jti, expiresAt: refreshExpiresAt(refreshToken) });
  return {
    role: claims.role,
    mustChangePassword: claims.mustChangePassword,
    tokens: { accessToken: signAccess(claims), refreshToken },
  };
}

// Mint a fresh access+refresh pair carrying the SAME scope (role/society/
// member/profile) as an existing verified access token, but with an updated
// mustChangePassword claim. Used right after a password change: the old
// access token still has mustChangePassword baked in and stays valid (by
// signature) until it naturally expires, so every route kept 403'ing
// "Password change required" even though the DB was already updated. The
// client must swap to this new pair immediately instead of waiting out the
// old token's TTL.
export async function reissueTokens(oldClaims, user) {
  const jti = randomUUID();
  const claims = {
    userId: oldClaims.userId,
    role: oldClaims.role,
    societyId: oldClaims.societyId,
    memberId: oldClaims.memberId,
    kind: oldClaims.kind ?? "Residential",
    shopId: oldClaims.shopId,
    activeProfileId: oldClaims.activeProfileId,
    occupancyType: oldClaims.occupancyType,
    mustChangePassword: user.mustChangePassword === true || undefined,
    jti,
  };
  const refreshToken = signRefresh({
    userId: oldClaims.userId,
    jti,
    profileId: oldClaims.activeProfileId,
  });
  await RefreshToken.create({
    userId: user._id,
    jti,
    expiresAt: refreshExpiresAt(refreshToken),
  });
  return {
    role: claims.role,
    mustChangePassword: claims.mustChangePassword,
    tokens: { accessToken: signAccess(claims), refreshToken },
  };
}

// PII-safe Member projection for GET /v1/auth/me (never spread a raw Member
// doc — it carries PAN/Aadhaar/banking/history fields).
export function toMemberDto(m) {
  if (!m) return null;
  return {
    _id: String(m._id),
    ownerName: m.ownerName ?? null,
    flatNo: m.flatNo ?? null,
    wing: m.wing ?? null,
    flatType: m.flatType ?? null,
    ownershipType: m.ownershipType ?? null,
    carpetAreaSqft: m.carpetAreaSqft ?? null,
    builtUpAreaSqft: m.builtUpAreaSqft ?? null,
    hasVotingRights: m.hasVotingRights ?? null,
    contactNumber: m.contactNumber ?? null,
    alternateContact: m.alternateContact ?? null,
    whatsappNumber: m.whatsappNumber ?? null,
    emailPrimary: m.emailPrimary ?? null,
    emailSecondary: m.emailSecondary ?? null,
    possessionDate: m.possessionDate ?? null,
    emergencyContact: m.emergencyContact
      ? {
          name: m.emergencyContact.name ?? null,
          relation: m.emergencyContact.relation ?? null,
          phoneNumber: m.emergencyContact.phoneNumber ?? null,
        }
      : null,
    currentTenant: m.currentTenant
      ? {
          name: m.currentTenant.name ?? null,
          contactNumber: m.currentTenant.contactNumber ?? null,
          email: m.currentTenant.email ?? null,
          startDate: m.currentTenant.startDate ?? null,
          endDate: m.currentTenant.endDate ?? null,
          depositAmount: m.currentTenant.depositAmount ?? 0,
          rentPerMonth: m.currentTenant.rentPerMonth ?? 0,
          isCurrent: m.currentTenant.isCurrent === true,
        }
      : null,
    tenantHistory: Array.isArray(m.tenantHistory)
      ? m.tenantHistory.map((t) => ({
          name: t.name ?? null,
          contactNumber: t.contactNumber ?? null,
          email: t.email ?? null,
          startDate: t.startDate ?? null,
          endDate: t.endDate ?? null,
          depositAmount: t.depositAmount ?? 0,
          rentPerMonth: t.rentPerMonth ?? 0,
          isCurrent: t.isCurrent === true,
        }))
      : [],
    parkingSlots: Array.isArray(m.parkingSlots)
      ? m.parkingSlots.map((p) => ({ slotNumber: p.slotNumber ?? null, type: p.type ?? null, vehicleType: p.vehicleType ?? null }))
      : [],
    familyMembers: Array.isArray(m.familyMembers)
      ? m.familyMembers.map((f) => ({
          _id: f._id ? String(f._id) : null,
          name: f.name ?? null,
          relation: f.relation ?? null,
          age: f.age ?? null,
          contactNumber: f.contactNumber ?? null,
          occupation: f.occupation ?? null,
        }))
      : [],
  };
}

export function toSocietyDto(s) {
  if (!s) return null;
  return { _id: String(s._id), name: s.name ?? null, address: s.address ?? null };
}
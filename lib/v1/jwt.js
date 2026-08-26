// Self-contained JWT helpers for the /v1 (mobile) API. Ported from the
// mobile-backend's src/lib/jwt.ts so token issuance/verification behaves
// exactly as the deployed mobile backend did.
//
// Access tokens are signed with JWT_SECRET (same secret the web app uses),
// refresh tokens with REFRESH_JWT_SECRET (falls back to JWT_SECRET if unset).
import jwt from "jsonwebtoken";

function accessSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not configured");
  return s;
}
function refreshSecret() {
  // PROD-04: REFRESH_JWT_SECRET is the one canonical name (matches
  // lib/refresh-token.js, the web refresh path). REFRESH_SECRET is read only
  // as a legacy fallback for anyone with the old var name still deployed —
  // set REFRESH_JWT_SECRET and drop REFRESH_SECRET when convenient.
  const s = process.env.REFRESH_JWT_SECRET || process.env.REFRESH_SECRET || process.env.JWT_SECRET;
  if (!s) throw new Error("REFRESH_JWT_SECRET / JWT_SECRET is not configured");
  return s;
}

const ACCESS_TTL = process.env.ACCESS_TTL || "15m";
const REFRESH_TTL = process.env.REFRESH_TTL || "30d";

export function signAccess(claims) {
  return jwt.sign(claims, accessSecret(), { expiresIn: ACCESS_TTL });
}
export function signRefresh(payload) {
  return jwt.sign(payload, refreshSecret(), { expiresIn: REFRESH_TTL });
}
export function verifyAccess(token) {
  return jwt.verify(token, accessSecret());
}
export function verifyRefresh(token) {
  return jwt.verify(token, refreshSecret());
}
// Read the refresh token's own exp claim so the DB revocation window can
// never drift from the JWT.
export function refreshExpiresAt(token) {
  const decoded = jwt.decode(token);
  return new Date(decoded.exp * 1000);
}

import crypto from "crypto";

// Reversible storage for the Amenity Member Card credential.
//
// AmenityMemberCard used to store ONLY a SHA-256 hash of the token (see the
// model's own comment) — deliberately irreversible, so a DB dump could never
// forge a check-in. The tradeoff that decision didn't account for: the
// PLAINTEXT token only ever existed once, at issuance, and the client was
// responsible for caching it (flutter_secure_storage) forever after. Any
// reinstall, cleared app data, or device swap loses it permanently, with no
// recovery path — "ask the society office to reissue it" was aspirational;
// no reissue endpoint was ever built. That's the dead gray QR.
//
// Fix: encrypt the token at rest (AES-256-GCM) instead of only hashing it, so
// the server CAN decrypt it back for the card's own holder on every load, no
// client-side caching required. tokenHash stays for existing fast-path scan
// verification (unchanged) — tokenEnc is additive.
//
// This is a real security tradeoff, not a free upgrade: a raw DB dump now
// exposes ciphertext, not nothing. What still protects it: the key is derived
// from JWT_SECRET (never in the DB) via HKDF with a domain-separation label,
// so a DB-only breach still cannot decrypt anything without that secret too.
const ALGO = "aes-256-gcm";
const INFO = Buffer.from("amenity-card-qr-v1");

let cachedKey = null;
function key() {
  if (cachedKey) return cachedKey;
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is required to encrypt/decrypt amenity cards");
  cachedKey = Buffer.from(
    crypto.hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), INFO, 32),
  );
  return cachedKey;
}

// "<iv>.<authTag>.<ciphertext>", each base64url - one column, no delimiter
// collisions since none of the three ever contain '.'.
export function encryptToken(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((b) => b.toString("base64url")).join(".");
}

export function decryptToken(enc) {
  if (typeof enc !== "string") return null;
  const parts = enc.split(".");
  if (parts.length !== 3) return null;
  try {
    const [iv, authTag, ciphertext] = parts.map((p) => Buffer.from(p, "base64url"));
    const decipher = crypto.createDecipheriv(ALGO, key(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Corrupt/foreign ciphertext (or a key rotation) - treat as unavailable
    // rather than crashing the card list for every other card in the request.
    return null;
  }
}

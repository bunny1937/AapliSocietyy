// lib/turnstile.js
//
// Server-side verification for Cloudflare Turnstile. Every login route calls
// this before touching the DB — stops bot/credential-stuffing traffic at the
// cheapest possible point, ahead of the Redis rate limiter and any bcrypt
// compare.
//
// Skipped entirely under NODE_ENV==="test" so Jest/Playwright suites (which
// have no way to solve a real challenge) keep working unmodified.

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * @param {string} token - the cf-turnstile-response value from the client widget
 * @param {string} [remoteip] - caller's IP, improves Cloudflare's fraud scoring
 * @returns {Promise<boolean>} true if the token is valid
 */
export async function verifyTurnstileToken(token, remoteip) {
  if (process.env.NODE_ENV === "test") return true;

  if (!token || typeof token !== "string") return false;

  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Misconfiguration, not a client failure — fail closed but log loudly so
    // it's not mistaken for a wave of bot traffic.
    console.error("TURNSTILE_SECRET_KEY is not set — rejecting all logins");
    return false;
  }

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteip) body.set("remoteip", remoteip);

    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await res.json();
    return data.success === true;
  } catch (err) {
    console.error("Turnstile verify request failed:", err);
    return false;
  }
}

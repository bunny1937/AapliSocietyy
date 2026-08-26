// Feature kill switches + cron auth, ported from mobile-backend config/env.ts.
// Both write switches default OFF (the mobile backend shipped them off) so the
// /v1 layer cannot mutate billing/complaint state until explicitly enabled.
export function billWritesEnabled() {
  return process.env.BILL_WRITES_ENABLED === "true";
}

export function complaintStatusWritesEnabled() {
  return process.env.COMPLAINT_STATUS_WRITES_ENABLED === "true";
}

// Timing-safe-ish comparison so the secret is not leaked by early exit.
function secretMatches(candidate, secret) {
  if (typeof candidate !== "string" || candidate.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i += 1) {
    diff |= candidate.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  return diff === 0;
}

// Cron endpoints: if CRON_SECRET is unset, allow only outside production
// (dev convenience) — SEC-04. An unset secret in production must fail
// closed, since these routes include destructive/data-purge jobs.
//
// Accepts every scheduler convention so external services work out of the box:
//   Authorization: Bearer <CRON_SECRET>   (Vercel Cron)
//   Authorization: <CRON_SECRET>          (cron-job.org custom header)
//   x-cron-secret: <CRON_SECRET>          (header-only schedulers)
export function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";

  const headers = req?.headers;
  const readHeader = (name) => {
    if (!headers) return "";
    const value = typeof headers.get === "function" ? headers.get(name) : headers[name];
    return typeof value === "string" ? value.trim() : "";
  };

  const authHeader = readHeader("authorization");
  const candidates = [
    authHeader,
    authHeader.replace(/^Bearer\s+/i, "").trim(),
    readHeader("x-cron-secret"),
    readHeader("x-vercel-cron-secret"),
  ];

  // Query-string secret intentionally dropped: it leaks into access logs and
  // Referer headers (SEC-04 fix note).

  return candidates.some((candidate) => candidate && secretMatches(candidate, secret));
}

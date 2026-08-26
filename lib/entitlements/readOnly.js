// Read-only, enforced by HTTP method at the edge.
//
// ## Why not a check in every mutating handler
//
// There are several hundred write routes. Adding a guard to each works until
// somebody forgets, and the forgotten one is a society that has stopped paying
// still creating bills. Method is the one property every write shares and no
// handler can opt out of, so the gate reads it and nothing else.
//
// ## The wrinkle, and it is a real one
//
// Some endpoints *read* via POST — search with a filter body, report
// generation, anything whose query is too big for a URL. Blocking those in
// read-only mode would refuse a society the ability to look at its own data,
// which is precisely what read-only is supposed to still allow.
//
// There is no way to detect this from the request. A POST that reads and a POST
// that writes are identical on the wire. So they are listed. The list is short
// because most of the app is honest about its verbs, and every entry is a
// deliberate statement that this path does not mutate.
//
// Getting this wrong in the safe direction (a read POST wrongly blocked) shows
// up immediately as a broken page. Getting it wrong in the unsafe direction (a
// write listed here) means a lapsed society can still mutate. So entries are
// added only when the handler has been read.

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * POST endpoints that only read. Prefix-matched.
 *
 * Deliberately empty of guesses: anything added here has had its handler read
 * and confirmed non-mutating. An unlisted read-POST is a visible bug; a
 * wrongly-listed write is a silent hole.
 */
export const READ_ONLY_POST_PREFIXES = [
  // Each of these was surfaced by scripts/find-read-posts.mjs and then had its
  // handler read: no model write, no service call that writes, no audit row.
  // They take a body because their query is too large for a URL, not because
  // they change anything.
  //
  // A society in read-only must still be able to preview a bill run it will
  // not commit, export what it already has, and validate a file before
  // deciding whether to renew. Blocking those would make read-only mean
  // "cannot look at your own data", which is the opposite of the intent.
  "/api/billing/preview",
  "/api/billing/export",
  "/api/billing/validate-excel",
  "/api/commercial/preview-bills",
  "/api/bill-template/preview-fill",
  "/api/receipt-template/preview-fill",
  "/api/accounting/opening-balance/preview",
  "/api/admin/societies/validate-excel",
];

/** Paths that must work in every state, including blocked. */
export const ALWAYS_WRITABLE_PREFIXES = [
  // Leaving must never be blocked by the state you are leaving because of.
  "/api/v1/society-handover",
  // You must be able to log in — and to renew.
  "/api/auth",
  "/api/v1/auth",
  "/api/subscription",
];

const matches = (pathname, prefixes) =>
  prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export function isReadRequest(method, pathname) {
  if (READ_METHODS.has((method || "GET").toUpperCase())) return true;
  return matches(pathname, READ_ONLY_POST_PREFIXES);
}

export function isAlwaysWritable(pathname) {
  return matches(pathname, ALWAYS_WRITABLE_PREFIXES);
}

/**
 * The decision, given a snapshot and a request.
 *
 * @returns null when allowed, or { code, status, message } when refused.
 */
export function lifecycleRefusal({ snapshot, method, pathname, isMemberOwnData = false }) {
  if (!snapshot) return null; // cold key — same fail-open as the module gate
  if (isAlwaysWritable(pathname)) return null;

  // Blocked: nothing but the renewal and handover paths, with one exception.
  if (snapshot.canRead === false) {
    // Members did not fail to pay. They keep read access to their own records
    // right up until the society is actually offboarded, because locking a
    // resident out of their own receipts applies pressure to the wrong person.
    if (isMemberOwnData && isReadRequest(method, pathname)) return null;
    return {
      code: "SUBSCRIPTION_BLOCKED",
      status: 402,
      message: "This society's subscription has ended.",
    };
  }

  if (snapshot.canWrite === false && !isReadRequest(method, pathname)) {
    return {
      code: "SUBSCRIPTION_READ_ONLY",
      status: 402,
      message:
        "This society's subscription has ended. The account is read-only until it is renewed — you can still view and export everything.",
    };
  }

  return null;
}

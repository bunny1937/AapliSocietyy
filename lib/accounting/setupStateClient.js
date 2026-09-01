/**
 * AapliSociety — one client-side reader for /api/accounting/setup-state.
 * ============================================================================
 * CLIENT ONLY.
 *
 * ## Why this exists rather than a bare fetch()
 *
 * lib/mongodb.js fails fast on purpose: serverSelectionTimeoutMS is 5s, and a
 * cold start that misses that window returns 503 so the client can retry
 * instead of pinning a billed instance for two minutes. That is the right call
 * on the server, and it puts the retry obligation on the caller.
 *
 * Every accounting page was written as `state = res.ok ? json : null`, which
 * turns that transient 503 into a page that quietly claims the society has no
 * Financial Year — the Entries page rendered "Nothing recorded yet" over a
 * voucher that was sitting in the database. A blank screen that says the wrong
 * thing confidently is worse than an error, because nobody goes looking.
 *
 * So: one retry on a 5xx, and a failure that is distinguishable from an
 * honest empty answer.
 *
 * `available: false` is NOT a failure — it is the server saying this user
 * lacks the permission, and the page should render without the banner.
 */

/** A transient server-side failure, as opposed to "no, you can't see this". */
export class SetupStateUnavailable extends Error {
  constructor(status) {
    super("Could not reach the accounting setup state.");
    this.name = "SetupStateUnavailable";
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object}  [opts]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<object>} the setup state, or `{ available: false }`
 * @throws {SetupStateUnavailable} on a 5xx that survived one retry
 */
export async function fetchSetupState({ signal } = {}) {
  let last = 0;
  // Two attempts. The cold start that produced the 503 has, by the time it
  // answered, already opened the connection the second attempt reuses.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt) await sleep(400);
    const res = await fetch("/api/accounting/setup-state?optional=1", {
      credentials: "include",
      signal,
    });
    if (res.ok) return (await res.json().catch(() => null)) || { available: false };
    last = res.status;
    // 4xx is an answer, not a blip — retrying it just doubles the wait.
    if (res.status < 500) return { available: false };
  }
  throw new SetupStateUnavailable(last);
}

export default fetchSetupState;

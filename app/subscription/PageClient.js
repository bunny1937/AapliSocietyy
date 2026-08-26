"use client";

// The blocked screen.
//
// Written for a committee member who is annoyed, possibly embarrassed, and
// needs to know two things: what happened, and what they can do now. Not a
// paywall pitch, not a feature list, not a countdown designed to panic anyone.
//
// The second button matters more than the first. A society that has decided to
// leave must be able to leave with its data, and burying that behind the
// renewal option — or omitting it — turns a billing dispute into a regulatory
// complaint. It sits at equal weight, deliberately.

const S = {
  wrap: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: "2rem",
    background: "var(--bg-sunken, #f6f7f9)",
  },
  card: {
    maxWidth: 560,
    width: "100%",
    background: "var(--bg-surface, #fff)",
    border: "1px solid var(--border, #e5e7eb)",
    borderRadius: 14,
    padding: "2.25rem",
  },
  h1: { fontSize: "1.35rem", fontWeight: 700, margin: "0 0 0.5rem", color: "var(--fg-1, #111)" },
  lead: { fontSize: "0.95rem", lineHeight: 1.7, color: "var(--fg-2, #374151)", margin: "0 0 1rem" },
  muted: { fontSize: "0.85rem", lineHeight: 1.7, color: "var(--fg-3, #6b7280)", margin: 0 },
  actions: { display: "flex", gap: 12, flexWrap: "wrap", margin: "1.75rem 0 1.25rem" },
  primary: {
    background: "var(--primary, #111)",
    color: "#fff",
    padding: "0.75rem 1.5rem",
    borderRadius: 8,
    textDecoration: "none",
    fontWeight: 600,
    fontSize: "0.9rem",
    border: "none",
    display: "inline-block",
  },
  secondary: {
    background: "transparent",
    color: "var(--fg-1, #111)",
    padding: "0.75rem 1.5rem",
    borderRadius: 8,
    textDecoration: "none",
    fontWeight: 600,
    fontSize: "0.9rem",
    border: "1px solid var(--border-strong, #d1d5db)",
    display: "inline-block",
  },
  note: {
    background: "var(--bg-muted, #f3f4f6)",
    borderRadius: 8,
    padding: "0.9rem 1.1rem",
    fontSize: "0.83rem",
    lineHeight: 1.7,
    color: "var(--fg-3, #6b7280)",
  },
};

export default function PageClient({ societyName, expiredAt, daysBlocked }) {
  const ended = expiredAt
    ? new Date(expiredAt).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <div style={S.wrap}>
      <div style={S.card}>
        <h1 style={S.h1}>{societyName}&apos;s subscription has ended</h1>

        <p style={S.lead}>
          {ended
            ? `The subscription ended on ${ended}, and the account has now been closed for use.`
            : "The subscription has ended and the account has now been closed for use."}{" "}
          Nothing has been deleted — all of your society&apos;s records are still here.
        </p>

        <div style={S.actions}>
          <a href="/subscription/renew" style={S.primary}>
            Renew subscription
          </a>
          {/* Equal weight, on purpose. Leaving with your own data is not a
              lesser option than paying, and presenting it as one would be
              both dishonest and, given the data-protection position, unwise. */}
          <a href="/admin/data-handover" style={S.secondary}>
            Download our records
          </a>
        </div>

        <div style={S.note}>
          <strong>Residents are not affected in the same way.</strong> Members can still sign in and
          view their own bills, receipts and payment history — they did not fail to pay, and locking
          them out would apply pressure to the wrong people. Only the committee&apos;s admin
          functions are closed.
          {daysBlocked > 0 && (
            <>
              {" "}
              This account has been closed for {daysBlocked} day{daysBlocked === 1 ? "" : "s"}.
            </>
          )}
        </div>

        <p style={{ ...S.muted, marginTop: "1.25rem" }}>
          If you believe this is a mistake, or you have already paid, reply to any invoice email and
          we will sort it out.
        </p>
      </div>
    </div>
  );
}

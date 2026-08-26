import Link from "next/link";

// The page a rewrite lands on when a route does not exist — including when it
// exists but the society has not bought the module it belongs to.
//
// Deliberately says nothing about entitlements. A page reading "upgrade to
// unlock Amenities" would be the 403 problem all over again: it confirms the
// feature exists, tells anyone mapping the platform what to look for, and
// turns a plain miss into a locked door somebody now wants to open. To the
// visitor this is, and must look like, a URL that was never a route.
//
// The society still finds out what it could buy — from a sales conversation
// prompted by the Phase 3 alert, which is a person talking to a person rather
// than a wall with a price on it.
export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "70vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 420 }}>
        <div style={{ fontSize: "3rem", fontWeight: 700, color: "var(--fg-3)", lineHeight: 1 }}>
          404
        </div>
        <h1 style={{ fontSize: "1.15rem", fontWeight: 700, margin: "0.75rem 0 0.4rem", color: "var(--fg-1)" }}>
          Page not found
        </h1>
        <p style={{ fontSize: "0.9rem", color: "var(--fg-3)", lineHeight: 1.6, margin: 0 }}>
          The page you were looking for doesn&apos;t exist. It may have been moved, or the link
          may be out of date.
        </p>
        <Link
          href="/"
          style={{
            display: "inline-block",
            marginTop: "1.5rem",
            background: "var(--fg-1)",
            color: "var(--bg-surface)",
            padding: "0.6rem 1.4rem",
            borderRadius: 6,
            textDecoration: "none",
            fontSize: "0.85rem",
            fontWeight: 600,
          }}
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}

"use client";
export default function MakePaymentPage() {
  return (
    <div style={{ padding: "3rem", textAlign: "center" }}>
      <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🔒</div>
      <h2 style={{ fontSize: "1.25rem", fontWeight: "700", color: "var(--fg-1)", marginBottom: "0.5rem" }}>
        Online Payments Coming Soon
      </h2>
      <p style={{ color: "var(--fg-4)", fontSize: "0.9rem", maxWidth: "360px", margin: "0 auto" }}>
        Online payment is not yet enabled. Please pay your maintenance bill directly to the society office and request a receipt.
      </p>
    </div>
  );
}

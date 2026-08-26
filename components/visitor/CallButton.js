"use client";
// components/visitor/CallButton.js
// One-tap native call. Opens the phone dialer instantly — no app, works offline.
const S = {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "10px 16px",
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 600,
    textDecoration: "none",
    cursor: "pointer",
    border: "1px solid var(--border-strong)",
    color: "var(--fg-1)",
    background: "var(--bg-surface)",
  },
  primary: { border: "none", color: "#fff", background: "var(--primary-hover)" },
  disabled: { opacity: 0.5, pointerEvents: "none" },
};
export default function CallButton({ phone, label, variant = "default", title = "Call" }) {
  const clean = String(phone || "").replace(/[^\d+]/g, "");
  const text = label || (clean ? "\uD83D\uDCDE Call" : "\uD83D\uDCDE No number");
  const style =
    variant === "primary" ? Object.assign({}, S.base, S.primary) : Object.assign({}, S.base);
  if (!clean) {
    const disabledStyle = Object.assign({}, style, S.disabled);
    return (
      <span style={disabledStyle} title="No phone number on file">
        {text}
      </span>
    );
  }
  return (
    <a href={"tel:" + clean} style={style} title={title}>
      {text}
    </a>
  );
}

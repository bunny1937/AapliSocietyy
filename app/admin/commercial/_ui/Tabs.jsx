"use client";

// Tabs for the shop drawer. A tab can be disabled with a reason (shown as a
// title tooltip) — used for "Owner & access" / "Listing & hours" / "Orders"
// on a brand-new shop that has no id yet, so switching to them can't happen
// before there's anything to load.
export default function Tabs({ items, value, onChange }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        borderBottom: "1px solid var(--cx-border)",
        marginBottom: 16,
        flexWrap: "wrap",
      }}
    >
      {items.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            disabled={t.disabled}
            title={t.disabled ? t.disabledReason : undefined}
            onClick={() => !t.disabled && onChange(t.value)}
            style={{
              padding: "8px 12px",
              fontSize: 12.5,
              fontWeight: 600,
              fontFamily: "inherit",
              background: "transparent",
              border: "none",
              borderBottom: active ? "2px solid var(--cx-brand)" : "2px solid transparent",
              color: t.disabled ? "var(--cx-fg-5)" : active ? "var(--cx-brand)" : "var(--cx-fg-3)",
              cursor: t.disabled ? "not-allowed" : "pointer",
              marginBottom: -1,
              whiteSpace: "nowrap",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

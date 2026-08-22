"use client";
// app/admin/commercial/shops/_ChargesSection.jsx
//
// The per-unit half of the commercial rate card.
//
// The rate card says WHAT a charge is and HOW MUCH. This says WHO IT LANDS ON.
// Before it existed there was no answer to that question at all: the engine
// billed every active head to every shop of the class, so a shop with no board
// paid signage, a shop with no slot paid parking, and a shop on its own meter
// paid the society's common electricity.
//
// It is deliberately the same component on the create drawer and the edit page.
// Signage used to be tickable only at creation and invisible afterwards, which
// meant a wrong answer at 9am was unfixable at 10am.

import { useMemo } from "react";
import { headAppliesToShop, isFundHead } from "@/lib/commercial/shopChargeApplicability";

const inr = (n) =>
  (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const box = {
  border: "1px solid var(--cx-border)",
  borderRadius: 10,
  overflow: "hidden",
};

const rowStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) auto",
  gap: 12,
  alignItems: "center",
  padding: "10px 12px",
  borderTop: "1px solid var(--cx-border)",
};

/**
 * @param heads          rows from GET /api/commercial/billing-heads
 * @param unitKind       "Shop" | "Office" — which class's heads to show
 * @param areaSqft       used only to show what a per-sq-ft head would come to
 * @param electricityMode the shop's own setting, so the common-electricity row
 *                        can explain itself instead of silently vanishing
 * @param value          the shop's chargeOptIns array
 * @param onChange       (nextChargeOptIns) => void
 * @param disabled       read-only rendering while a save is in flight
 */
export default function ChargesSection({
  heads,
  unitKind = "Shop",
  areaSqft = 0,
  electricityMode = "Own connection",
  value = [],
  onChange,
  disabled = false,
}) {
  const area = Number(areaSqft) || 0;

  const scoped = useMemo(
    () =>
      (heads || [])
        .filter(
          (h) =>
            h.isActive !== false &&
            !isFundHead(h) &&
            Array.isArray(h.categoryScope) &&
            h.categoryScope.includes(unitKind),
        )
        .sort((a, b) => Number(a.sortOrder ?? 500) - Number(b.sortOrder ?? 500)),
    [heads, unitKind],
  );

  const rowFor = (headId) => (value || []).find((r) => String(r.headId) === String(headId)) || null;

  const setRow = (head, patch) => {
    if (disabled) return;
    const id = String(head.id ?? head._id);
    const existing = rowFor(id);
    const next = existing
      ? (value || []).map((r) => (String(r.headId) === id ? { ...r, ...patch } : r))
      : [
          ...(value || []),
          {
            headId: id,
            optInKey: head.optInKey ?? null,
            enabled: false,
            quantity: 0,
            note: null,
            ...patch,
          },
        ];
    onChange(next);
  };

  // What this head would actually add to the bill, using the same rules the
  // engine uses, so the admin sees the money BEFORE saving.
  const amountFor = (head, quantity) => {
    const rate = head.rate?.[unitKind];
    if (rate === null || rate === undefined || rate === "") return null;
    if (head.calculationType === "Per Sq Ft") {
      if (area <= 0) return null;
      return Math.round(area * Number(rate) * quantity * 100) / 100;
    }
    if (head.calculationType === "Percentage") return null; // depends on the rest of the bill
    return Math.round(Number(rate) * quantity * 100) / 100;
  };

  const shopShape = { chargeOptIns: value || [], electricityMode };

  let runningTotal = 0;
  const rows = scoped.map((head) => {
    const id = String(head.id ?? head._id);
    const mode = head.applicability || "All";
    const stored = rowFor(id);
    const verdict = headAppliesToShop(head, shopShape);
    const qty = mode === "Quantity" ? Number(stored?.quantity) || 0 : 1;
    const amount = verdict.applies ? amountFor(head, verdict.quantity || qty) : null;
    if (amount !== null) runningTotal += amount;
    return { head, id, mode, stored, verdict, qty, amount };
  });

  if (!scoped.length) {
    return (
      <div style={{ ...box, padding: "14px 12px", fontSize: 12.5, color: "var(--cx-fg-3)" }}>
        No {unitKind.toLowerCase()} charges have been set up on the rate card yet, so this unit
        would be billed nothing. Add them on the Commercial Rate Card first.
      </div>
    );
  }

  return (
    <div style={box}>
      <div
        style={{
          padding: "9px 12px",
          background: "var(--cx-surface-2)",
          fontSize: 11.5,
          fontWeight: 700,
          color: "var(--cx-fg-2)",
        }}
      >
        What this unit is billed each month
      </div>

      {rows.map(({ head, id, mode, stored, verdict, qty, amount }) => {
        const rate = head.rate?.[unitKind];
        const rateBlank = rate === null || rate === undefined || rate === "";
        return (
          <div key={id} style={rowStyle}>
            <div style={{ minWidth: 0 }}>
              <label
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  cursor: mode === "All" || disabled ? "default" : "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={mode === "All" ? true : !!stored?.enabled}
                  disabled={mode === "All" || disabled}
                  onChange={(e) =>
                    setRow(head, {
                      enabled: e.target.checked,
                      quantity: e.target.checked ? Math.max(1, qty) : 0,
                    })
                  }
                  style={{ marginTop: 2 }}
                />
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cx-fg-1)" }}>
                    {head.headName}
                  </span>
                  <span
                    style={{
                      display: "block",
                      fontSize: 11.5,
                      color: "var(--cx-fg-4)",
                      lineHeight: 1.5,
                      marginTop: 2,
                    }}
                  >
                    {rateBlank
                      ? `No ${unitKind} amount set on the rate card — nothing will be billed.`
                      : head.calculationType === "Per Sq Ft"
                        ? `₹${rate} per sq ft${area > 0 ? ` × ${area} sq ft` : " (no area recorded yet)"}`
                        : head.calculationType === "Percentage"
                          ? `${rate}% of the fixed and per-sq-ft charges`
                          : `₹${inr(rate)} a month`}
                    {mode === "All" && " · charged to every unit"}
                  </span>
                  {!verdict.applies && verdict.reason && (
                    <span
                      style={{
                        display: "block",
                        fontSize: 11.5,
                        color: "var(--cx-fg-3)",
                        lineHeight: 1.5,
                        marginTop: 3,
                      }}
                    >
                      {verdict.reason}
                    </span>
                  )}
                </span>
              </label>

              {mode === "Quantity" && stored?.enabled && (
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    marginTop: 8,
                    marginLeft: 24,
                  }}
                >
                  <input
                    type="number"
                    min="0"
                    max="999"
                    step="1"
                    inputMode="numeric"
                    disabled={disabled}
                    value={stored?.quantity ?? 0}
                    onChange={(e) => setRow(head, { quantity: e.target.value })}
                    style={{
                      width: 74,
                      padding: "5px 8px",
                      border: "1px solid var(--cx-border)",
                      borderRadius: 6,
                      fontSize: 13,
                    }}
                  />
                  <span style={{ fontSize: 11.5, color: "var(--cx-fg-4)" }}>
                    {head.quantityLabel || "allotted to this unit"}
                  </span>
                </div>
              )}
            </div>

            <div
              className="cx-num"
              style={{
                fontSize: 14,
                fontWeight: 700,
                whiteSpace: "nowrap",
                color: amount === null ? "var(--cx-fg-4)" : "var(--cx-fg-1)",
              }}
            >
              {amount === null ? "—" : `₹${inr(amount)}`}
            </div>
          </div>
        );
      })}

      <div
        style={{
          ...rowStyle,
          background: "var(--cx-surface-2)",
          fontWeight: 700,
        }}
      >
        <span style={{ fontSize: 13, color: "var(--cx-fg-1)" }}>
          Monthly charges for this unit
        </span>
        <span className="cx-num" style={{ fontSize: 15, color: "var(--cx-brand)" }}>
          ₹{inr(runningTotal)}
        </span>
      </div>

      <div
        style={{
          padding: "9px 12px",
          borderTop: "1px solid var(--cx-border)",
          fontSize: 11,
          color: "var(--cx-fg-4)",
          lineHeight: 1.6,
        }}
      >
        Sinking fund, repair fund, GST, non-occupancy, arrears and interest are billed
        society-wide from Rules &amp; Tax on this rate card, not per unit — they're added
        when the bill is generated, so the real bill is usually higher than this.
      </div>
    </div>
  );
}

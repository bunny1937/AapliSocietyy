"use client";
/**
 * <Term> — plain-language "What is this?" explainer (§7.24 of
 * docs/accounting-module-audit-and-consolidation-plan.md). Wraps a word,
 * shows a small (?) that reveals one short sentence on click — no help page,
 * no modal, contextual and dismissible.
 */
import { useState } from "react";

const GLOSSARY = {
  "Trial Balance": "A list of every account and its balance, debit and credit sides added up separately — they must match exactly, or something in the books is wrong.",
  Accrual: "Recording income or expense when it's earned or owed, not just when cash actually moves — a bill counts the day it's raised, not the day it's paid.",
  Depreciation: "Spreading the cost of something the society owns (a pump, CCTV, furniture) over the years it's used, instead of charging its full price in one year.",
  Provision: "Money set aside now for a cost you know is coming but haven't paid yet — an audit fee not yet billed, for example.",
  Schedule: "The heading a Balance Sheet groups an account under — Schedule A is Share Capital, Schedule E is Fixed Assets, and so on.",
  Appropriation: "Deciding what a year's surplus becomes — moving it into the Reserve or Sinking Fund instead of leaving it sitting as plain surplus.",
  Reconciliation: "Matching what your bank statement says against what your books say, line by line, until both agree.",
  "Opening Balance": "What the society had — cash, bank, dues, funds — on the very first day of a financial year, carried in from last year's closing figures.",
  Closing: "Locking a financial year once every check passes, so nothing in it can be edited afterwards.",
};

export default function Term({ word, children }) {
  const [open, setOpen] = useState(false);
  const gloss = GLOSSARY[word];
  const label = children || word;
  if (!gloss) return <>{label}</>;
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 3 }}>
      {label}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title={`What is ${word}?`}
        style={{
          width: 14, height: 14, borderRadius: 999, border: "1px solid var(--r-fg-4)",
          background: "none", color: "var(--r-fg-4)", fontSize: 9.5, lineHeight: "12px",
          cursor: "pointer", padding: 0, flexShrink: 0,
        }}
      >?</button>
      {open ? (
        <span
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 50, width: 240,
            background: "var(--r-surface)", border: "1px solid var(--r-hairline)", borderRadius: 8,
            boxShadow: "0 8px 20px rgba(0,0,0,0.18)", padding: "9px 11px", fontSize: 12,
            lineHeight: 1.55, color: "var(--r-fg-2)", fontWeight: 400, whiteSpace: "normal",
          }}
        >
          {gloss}
        </span>
      ) : null}
    </span>
  );
}

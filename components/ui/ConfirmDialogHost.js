"use client";
import { useEffect, useState } from "react";

// Imperative confirm()/prompt() replacement, styled to match the app's dark
// admin theme. Mounted once in the root layout; any client component calls
// the exported confirmDialog()/promptDialog() functions below exactly like
// the window.confirm()/window.prompt() they replace (await + a return value),
// with no hooks or context wiring needed at each call site.
let dispatch = null;

const TONE_STYLES = {
  danger: { accent: "var(--danger)", border: "var(--danger)", bg: "var(--danger-bg)", btn: "var(--danger)" },
  warning: { accent: "var(--warning)", border: "var(--warning)", bg: "var(--warning-bg)", btn: "var(--warning)" },
  info: { accent: "var(--info)", border: "var(--info)", bg: "var(--info-bg)", btn: "var(--info)" },
};

export function confirmDialog({ title = "Are you sure?", message = "", tone = "danger", confirmLabel = "Confirm", cancelLabel = "Cancel" } = {}) {
  return new Promise((resolve) => {
    dispatch?.({ kind: "confirm", title, message, tone, confirmLabel, cancelLabel, resolve });
  });
}

export function promptDialog({ title = "Enter a value", message = "", defaultValue = "", tone = "info", confirmLabel = "OK", cancelLabel = "Cancel", inputType = "text" } = {}) {
  return new Promise((resolve) => {
    dispatch?.({ kind: "prompt", title, message, tone, confirmLabel, cancelLabel, defaultValue, inputType, resolve });
  });
}

export default function ConfirmDialogHost() {
  const [state, setState] = useState(null);
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    dispatch = (next) => {
      setState(next);
      setInputValue(next?.defaultValue || "");
    };
    return () => { dispatch = null; };
  }, []);

  if (!state) return null;
  const t = TONE_STYLES[state.tone] || TONE_STYLES.info;

  const finish = (result) => {
    state.resolve(result);
    setState(null);
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(3px)", zIndex: 20000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={() => finish(state.kind === "confirm" ? false : null)}
    >
      <div
        style={{
          background: `linear-gradient(180deg, ${t.bg} 0%, var(--bg-sunken) 100%)`,
          border: `1px solid ${t.border}`,
          borderRadius: 14,
          padding: "1.5rem",
          width: 420,
          maxWidth: "90vw",
          color: "var(--fg-1)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 0.5rem", fontSize: "1.02rem", color: t.accent, fontWeight: 700 }}>{state.title}</h3>
        {state.message && (
          <p style={{ margin: "0 0 1.1rem", fontSize: "0.85rem", color: "var(--fg-2)", lineHeight: 1.6, whiteSpace: "pre-line" }}>{state.message}</p>
        )}
        {state.kind === "prompt" && (
          <input
            autoFocus
            type={state.inputType}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") finish(inputValue); if (e.key === "Escape") finish(null); }}
            style={{
              width: "100%", boxSizing: "border-box", background: "var(--bg-sunken)", border: `1px solid ${t.border}`,
              borderRadius: 8, padding: "0.55rem 0.75rem", color: "var(--fg-1)", fontSize: "0.85rem", marginBottom: "1.1rem",
              outline: "none",
            }}
          />
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
          <button
            onClick={() => finish(state.kind === "confirm" ? false : null)}
            style={{ background: "var(--bg-muted)", color: "var(--fg-1)", border: "none", padding: "0.55rem 1.1rem", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: "0.82rem" }}
          >
            {state.cancelLabel}
          </button>
          <button
            autoFocus={state.kind === "confirm"}
            onClick={() => finish(state.kind === "confirm" ? true : inputValue)}
            style={{ background: t.btn, color: "#fff", border: "none", padding: "0.55rem 1.2rem", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: "0.82rem" }}
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

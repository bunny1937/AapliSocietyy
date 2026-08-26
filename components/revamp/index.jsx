"use client";
/**
 * Revamp ("Pulse") primitives — ported from the design system kit at
 * ui_kits/revamp/RevampPrimitives.jsx.
 *
 * The kit ships as browser-global JSX (window.Primitives, window.Icon); this
 * is the same component set rewritten as real ES modules with lucide-react
 * for icons. Every colour reads a --r-* CSS var, which styles/globals.css
 * defines for both themes — so these render correctly in light and dark
 * without any per-component theme branching.
 */
import { useEffect, useState } from "react";
import * as Lucide from "lucide-react";

/* ------------------------------------------------------------------ *
 * Icon — thin wrapper so call sites can pass kebab-case kit icon names
 * ("alert-triangle") instead of importing each lucide component.
 * ------------------------------------------------------------------ */
export function Icon({ name, size = 16, stroke = 1.75, color, style }) {
  const pascal = String(name || "")
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
  const C = Lucide[pascal] || Lucide.Circle;
  return <C size={size} strokeWidth={stroke} color={color} style={{ flexShrink: 0, ...style }} />;
}

/* ------------------------------------------------------------------ *
 * Btn
 * ------------------------------------------------------------------ */
const BTN_SIZES = {
  sm: { padding: "5px 9px", fontSize: 12, gap: 5, h: 26 },
  md: { padding: "7px 12px", fontSize: 13, gap: 6, h: 32 },
  lg: { padding: "10px 16px", fontSize: 14, gap: 8, h: 40 },
};
const BTN_VARIANTS = {
  primary: { background: "var(--r-brand)", color: "var(--r-brand-ink)", border: "1px solid var(--r-brand)" },
  secondary: { background: "var(--r-surface)", color: "var(--r-fg-2)", border: "1px solid var(--r-border)" },
  ghost: { background: "transparent", color: "var(--r-fg-2)", border: "1px solid transparent" },
  danger: { background: "var(--r-surface)", color: "var(--r-danger)", border: "1px solid var(--r-border)" },
  dangerSolid: { background: "var(--r-danger)", color: "#fff", border: "1px solid var(--r-danger)" },
};

export function Btn({ variant = "secondary", size = "md", icon, iconR, children, onClick, disabled, style, type, title }) {
  const s = BTN_SIZES[size] || BTN_SIZES.md;
  return (
    <button
      type={type || "button"}
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        gap: s.gap, padding: s.padding, fontSize: s.fontSize, fontWeight: 500,
        height: s.h, borderRadius: 8, fontFamily: "inherit",
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
        transition: "background 0.15s, border-color 0.15s, transform 0.06s",
        whiteSpace: "nowrap", lineHeight: 1,
        ...(BTN_VARIANTS[variant] || BTN_VARIANTS.secondary), ...style,
      }}
      onMouseEnter={(e) => { if (!disabled && variant === "ghost") e.currentTarget.style.background = "var(--r-surface-3)"; }}
      onMouseLeave={(e) => { if (!disabled && variant === "ghost") e.currentTarget.style.background = "transparent"; }}
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = "scale(0.97)"; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
    >
      {icon && <Icon name={icon} size={size === "lg" ? 16 : 14} />}
      {children}
      {iconR && <Icon name={iconR} size={size === "lg" ? 16 : 14} />}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Pill
 * ------------------------------------------------------------------ */
const PILL_TONES = {
  paid: { bg: "var(--r-success-soft)", fg: "var(--r-success)" },
  unpaid: { bg: "var(--r-danger-soft)", fg: "var(--r-danger)" },
  partial: { bg: "var(--r-warning-soft)", fg: "var(--r-warning)" },
  overdue: { bg: "var(--r-danger-soft)", fg: "var(--r-danger)" },
  active: { bg: "var(--r-success-soft)", fg: "var(--r-success)" },
  trial: { bg: "var(--r-brand-soft)", fg: "var(--r-brand)" },
  suspended: { bg: "var(--r-danger-soft)", fg: "var(--r-danger)" },
  expired: { bg: "var(--r-surface-3)", fg: "var(--r-fg-3)" },
  scheduled: { bg: "var(--r-surface-3)", fg: "var(--r-fg-3)" },
  info: { bg: "var(--r-brand-soft)", fg: "var(--r-brand)" },
  warning: { bg: "var(--r-warning-soft)", fg: "var(--r-warning)" },
  neutral: { bg: "var(--r-surface-3)", fg: "var(--r-fg-3)" },
};

export function Pill({ tone = "neutral", children, dot = true, style }) {
  const t = PILL_TONES[tone] || PILL_TONES.neutral;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "2px 8px", borderRadius: 999,
      fontSize: 11, fontWeight: 600, lineHeight: 1.4,
      background: t.bg, color: t.fg, whiteSpace: "nowrap", ...style,
    }}>
      {dot && <span className="revamp-dot" style={{ background: "currentColor" }} />}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Card / CardHead
 * ------------------------------------------------------------------ */
export function Card({ children, padded = true, style, hover = false, onClick, className }) {
  const [h, setH] = useState(false);
  return (
    <div
      className={className}
      onClick={onClick}
      onMouseEnter={() => hover && setH(true)}
      onMouseLeave={() => hover && setH(false)}
      style={{
        background: "var(--r-surface)",
        border: "1px solid var(--r-border)",
        borderRadius: "var(--r-radius-lg)",
        padding: padded ? "var(--r-pad-card)" : 0,
        boxShadow: h ? "var(--r-shadow-pop)" : "var(--r-shadow-card)",
        transition: "box-shadow 0.18s, transform 0.18s",
        transform: h ? "translateY(-1px)" : "none",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function CardHead({ title, sub, right, style }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, ...style }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--r-fg-2)" }}>{title}</div>
        {sub && <div style={{ fontSize: 11, color: "var(--r-fg-4)", marginTop: 2 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Progress
 * ------------------------------------------------------------------ */
export function Progress({ value, total = 100, color = "var(--r-brand)", height = 6 }) {
  const pct = Math.min(100, Math.max(0, (value / (total || 1)) * 100));
  return (
    <div style={{ width: "100%", height, background: "var(--r-surface-3)", borderRadius: 999, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 999, transition: "width 0.5s cubic-bezier(.16,1,.3,1)" }} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Sparkline
 * ------------------------------------------------------------------ */
export function Sparkline({ data, w = 80, h = 24, color = "var(--r-brand)", fill = true, id = "sg" }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const stepX = w / (data.length - 1);
  const pts = data.map((v, i) => [i * stepX, h - ((v - min) / range) * (h - 4) - 2]);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const gid = `spark-${id}`;
  return (
    <svg width={w} height={h} style={{ display: "block", maxWidth: "100%" }} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {fill && (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${d} L${w},${h} L0,${h} Z`} fill={`url(#${gid})`} />
        </>
      )}
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Avatar — deterministic gradient from the name
 * ------------------------------------------------------------------ */
export function Avatar({ name = "?", size = 28, style }) {
  const label = String(name || "?");
  const letters = label.split(" ").filter(Boolean).map((n) => n[0]).slice(0, 2).join("").toUpperCase() || "?";
  const seed = label.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = seed % 360;
  return (
    <div style={{
      width: size, height: size, borderRadius: 999, flexShrink: 0,
      background: `linear-gradient(135deg, hsl(${hue}, 45%, 55%), hsl(${(hue + 40) % 360}, 50%, 45%))`,
      color: "#fff", fontWeight: 700, fontSize: size * 0.38,
      display: "flex", alignItems: "center", justifyContent: "center",
      letterSpacing: "-0.02em", ...style,
    }}>{letters}</div>
  );
}

/* ------------------------------------------------------------------ *
 * SearchInput
 * ------------------------------------------------------------------ */
export function SearchInput({ value, onChange, placeholder, autoFocus, size = "md", style }) {
  const sizes = { sm: { p: "6px 10px 6px 30px", h: 30, fs: 12 }, md: { p: "8px 12px 8px 34px", h: 36, fs: 13 } };
  const s = sizes[size] || sizes.md;
  return (
    <div style={{ position: "relative", display: "inline-flex", width: "100%", ...style }}>
      <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--r-fg-4)", display: "flex", pointerEvents: "none" }}>
        <Icon name="search" size={size === "sm" ? 13 : 14} />
      </span>
      <input
        autoFocus={autoFocus}
        value={value || ""}
        onChange={(e) => onChange && onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%", padding: s.p, height: s.h, fontSize: s.fs,
          background: "var(--r-surface)", border: "1px solid var(--r-border)",
          borderRadius: 8, fontFamily: "inherit", color: "var(--r-fg-1)",
          outline: "none", transition: "border-color 0.12s, box-shadow 0.12s",
        }}
        onFocus={(e) => { e.target.style.borderColor = "var(--r-brand)"; e.target.style.boxShadow = "0 0 0 3px var(--r-brand-soft)"; }}
        onBlur={(e) => { e.target.style.borderColor = "var(--r-border)"; e.target.style.boxShadow = "none"; }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Select — native <select> dressed to match SearchInput
 * ------------------------------------------------------------------ */
export function Select({ value, onChange, children, size = "sm", style, title }) {
  const h = size === "sm" ? 30 : 36;
  return (
    <select
      value={value}
      title={title}
      onChange={(e) => onChange && onChange(e.target.value)}
      style={{
        height: h, padding: "0 26px 0 10px", fontSize: size === "sm" ? 12 : 13,
        background: "var(--r-surface)", color: "var(--r-fg-2)",
        border: "1px solid var(--r-border)", borderRadius: 8,
        fontFamily: "inherit", fontWeight: 500, cursor: "pointer", outline: "none",
        appearance: "none",
        backgroundImage: "linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%)",
        backgroundPosition: "calc(100% - 14px) center, calc(100% - 9px) center",
        backgroundSize: "5px 5px, 5px 5px",
        backgroundRepeat: "no-repeat",
        ...style,
      }}
    >
      {children}
    </select>
  );
}

/* ------------------------------------------------------------------ *
 * Segmented
 * ------------------------------------------------------------------ */
export function Segmented({ value, onChange, options }) {
  return (
    <div style={{ display: "inline-flex", padding: 3, background: "var(--r-surface-3)", borderRadius: 9, gap: 2, flexWrap: "wrap" }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} onClick={() => onChange(o.value)} style={{
            padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600, fontFamily: "inherit",
            border: "none", cursor: "pointer", whiteSpace: "nowrap",
            background: active ? "var(--r-surface)" : "transparent",
            color: active ? "var(--r-fg-1)" : "var(--r-fg-3)",
            boxShadow: active ? "0 1px 2px rgba(0,0,0,0.06), 0 0 0 1px var(--r-border)" : "none",
            transition: "background 0.12s, color 0.12s",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            {o.icon && <Icon name={o.icon} size={12} />}
            {o.label}
            {o.count != null && <span style={{ opacity: 0.6, fontWeight: 500 }}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * MiniTable
 * ------------------------------------------------------------------ */
export function MiniTable({ cols, rows, onRowClick }) {
  return (
    <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
      <thead>
        <tr>
          {cols.map((c, i) => (
            <th key={i} style={{
              textAlign: c.align || "left", padding: "8px 12px",
              fontSize: 10, fontWeight: 600, color: "var(--r-fg-4)",
              textTransform: "uppercase", letterSpacing: "0.6px",
              borderBottom: "1px solid var(--r-border)", background: "var(--r-surface-2)",
              whiteSpace: "nowrap",
            }}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.key ?? i} className="revamp-row" onClick={() => onRowClick && onRowClick(r, i)}
              style={{ cursor: onRowClick ? "pointer" : "default", transition: "background 0.1s" }}>
            {r.cells.map((cell, j) => (
              <td key={j} style={{
                padding: "10px 12px", borderBottom: "1px solid var(--r-hairline)",
                textAlign: cols[j].align || "left", color: "var(--r-fg-2)",
                fontVariantNumeric: cols[j].num ? "tabular-nums" : "normal",
              }}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ *
 * PageHeader — the kit's Shell.PageHeader
 * ------------------------------------------------------------------ */
export function PageHeader({ eyebrow, title, sub, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, marginBottom: 22, flexWrap: "wrap" }}>
      <div>
        {eyebrow && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: "var(--r-fg-4)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 8 }}>
            {eyebrow}
          </div>
        )}
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--r-fg-1)", letterSpacing: "-0.025em", lineHeight: 1.15, margin: 0 }}>{title}</h1>
        {sub && <p style={{ fontSize: 13, color: "var(--r-fg-3)", margin: "6px 0 0" }}>{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * SectionLabel — the small uppercase group heading used above bentos
 * ------------------------------------------------------------------ */
export function SectionLabel({ icon, children, style }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 11, fontWeight: 700, color: "var(--r-fg-4)", textTransform: "uppercase", letterSpacing: "0.7px", ...style }}>
      {icon && <Icon name={icon} size={12} />} {children}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * ActionTile — "needs attention" row on the dashboard
 * ------------------------------------------------------------------ */
export function ActionTile({ tone = "info", icon, headline, sub, cta, onClick }) {
  const tones = {
    danger: { bg: "var(--r-danger-soft)", fg: "var(--r-danger)" },
    warning: { bg: "var(--r-warning-soft)", fg: "var(--r-warning)" },
    info: { bg: "var(--r-brand-soft)", fg: "var(--r-brand)" },
    success: { bg: "var(--r-success-soft)", fg: "var(--r-success)" },
  };
  const t = tones[tone] || tones.info;
  return (
    <button onClick={onClick} style={{
      textAlign: "left", display: "flex", gap: 14, alignItems: "flex-start",
      padding: 16, borderRadius: 14, fontFamily: "inherit",
      background: "var(--r-surface)", border: "1px solid var(--r-border)",
      boxShadow: "var(--r-shadow-card)",
      cursor: onClick ? "pointer" : "default",
      transition: "border-color 0.15s, box-shadow 0.15s, transform 0.15s",
    }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = t.fg; e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "var(--r-shadow-pop)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--r-border)"; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "var(--r-shadow-card)"; }}
    >
      <div style={{ width: 38, height: 38, borderRadius: 10, background: t.bg, color: t.fg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon name={icon} size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--r-fg-1)", marginBottom: 2 }}>{headline}</div>
        <div style={{ fontSize: 12, color: "var(--r-fg-3)" }}>{sub}</div>
      </div>
      {cta && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: t.fg, whiteSpace: "nowrap" }}>
          {cta} <Icon name="arrow-right" size={13} />
        </div>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * MiniMetric — the bento tile
 * ------------------------------------------------------------------ */
export function MiniMetric({ label, value, delta, tone, icon, extra, onClick }) {
  return (
    <Card style={{ cursor: onClick ? "pointer" : "default" }} hover={!!onClick} onClick={onClick}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--r-fg-4)", fontWeight: 500 }}>
          <Icon name={icon} size={13} /> {label}
        </div>
        {onClick && <Icon name="arrow-up-right" size={13} color="var(--r-fg-5)" />}
      </div>
      <div className="revamp-num" style={{ fontSize: 28, fontWeight: 700, color: "var(--r-fg-1)", letterSpacing: "-0.02em", lineHeight: 1 }}>{value}</div>
      {delta && (
        <div style={{
          fontSize: 11, marginTop: 6, fontWeight: 500,
          color: tone === "paid" || tone === "success" ? "var(--r-success)"
            : tone === "danger" ? "var(--r-danger)" : "var(--r-fg-4)",
        }}>{delta}</div>
      )}
      {extra}
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * SmallStat — compact 4-up stat card (Members screen)
 * ------------------------------------------------------------------ */
export function SmallStat({ icon, label, value, tone, onClick }) {
  return (
    <Card style={{ padding: 14, cursor: onClick ? "pointer" : "default" }} hover={!!onClick} onClick={onClick}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11, color: "var(--r-fg-4)", fontWeight: 500, marginBottom: 6 }}>
        <Icon name={icon} size={12} /> {label}
      </div>
      <div className="revamp-num" style={{
        fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em",
        color: tone === "danger" ? "var(--r-danger)" : tone === "success" ? "var(--r-success)" : "var(--r-fg-1)",
      }}>{value}</div>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * SummaryStat — label over a big coloured number (Bills summary strip)
 * ------------------------------------------------------------------ */
export function SummaryStat({ label, value, tone, sub }) {
  const c = tone === "paid" ? "var(--r-success)" : tone === "overdue" ? "var(--r-danger)" : tone === "warning" ? "var(--r-warning)" : "var(--r-fg-1)";
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--r-fg-4)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>{label}</div>
      <div className="revamp-num" style={{ fontSize: 24, fontWeight: 700, color: c, letterSpacing: "-0.02em" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--r-fg-4)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * EmptyState
 * ------------------------------------------------------------------ */
export function EmptyState({ icon = "inbox", title, sub }) {
  return (
    <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--r-fg-4)" }}>
      <Icon name={icon} size={32} color="var(--r-fg-5)" style={{ margin: "0 auto" }} />
      {title && <p style={{ marginTop: 12, fontSize: 14, fontWeight: 600, color: "var(--r-fg-2)" }}>{title}</p>}
      {sub && <p style={{ marginTop: 4, fontSize: 13 }}>{sub}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Skeleton shimmer block, for the loading states of revamped screens
 * ------------------------------------------------------------------ */
export function RevampSkeleton({ h = 96, style }) {
  return <div className="skeleton" style={{ height: h, borderRadius: "var(--r-radius-lg)", ...style }} />;
}

/* ------------------------------------------------------------------ *
 * useIsDark — mirrors the kit's useIsDarkAV, but reads the app's
 * data-theme attribute instead of the kit's .theme-dark class.
 * Used only for the extra hover glow that dark mode adds.
 * ------------------------------------------------------------------ */
export function useIsDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const read = () => setDark(document.documentElement.getAttribute("data-theme") === "dark");
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

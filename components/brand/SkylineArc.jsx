// components/brand/SkylineArc.jsx — AapliSociety logo, "Skyline Arc" mark.
// Source: skyline-arc/ (design handoff — mark.svg, lockup.svg + reversed
// variants, README with usage rules). Copied here verbatim, static SVG
// files also live in public/brand/ for plain <img>/favicon use.
// Single brand colour #1e3a8a, no gradients. Minimum mark size 16px —
// below 24px the tower windows stop reading.
export const BRAND = "#1e3a8a";
const ko = (c) => (c === "#fff" || c === "#ffffff" || c === "white" ? BRAND : "#ffffff");

const TOWER_WINDOWS = [
  [13, 25], [16, 25], [13, 30], [16, 30], [13, 35], [16, 35], [13, 40], [16, 40],
  [26, 16], [30, 16], [33, 16], [26, 22], [30, 22], [33, 22], [26, 28], [30, 28], [33, 28],
  [26, 34], [30, 34], [33, 34], [26, 40], [30, 40], [33, 40],
  [42, 30], [46, 30], [50, 30], [42, 36], [46, 36], [50, 36], [42, 42], [46, 42], [50, 42],
];

export function SkylineArcMark({ color = BRAND, size = 64, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="AapliSociety" {...rest}>
      <g fill={color}>
        <rect x="10" y="20" width="11" height="32" />
        <rect x="23" y="10" width="14" height="42" />
        <rect x="39" y="26" width="15" height="26" />
        <path d="M 6 52 Q 32 60 58 52 L 58 56 Q 32 64 6 56 Z" />
        <g fill={ko(color)}>
          {TOWER_WINDOWS.map(([x, y]) => (
            <rect key={`${x}-${y}`} x={x} y={y} width="2" height="2" />
          ))}
        </g>
      </g>
    </svg>
  );
}

/** Horizontal lockup: mark + wordmark + descriptor. */
export function SkylineArcLockup({ onBrand = false, markSize = 68, gap = 16 }) {
  const ink = onBrand ? "#ffffff" : BRAND;
  const sub = onBrand ? "rgba(255,255,255,0.7)" : "#6b7280";
  return (
    <div style={{ display: "flex", alignItems: "center", gap }}>
      <SkylineArcMark color={ink} size={markSize} />
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.5px", color: ink }}>
          <span>Aapli</span>
          <span style={{ fontWeight: 500 }}>Society</span>
        </div>
        <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "1.5px", color: sub, marginTop: 6 }}>
          SOCIETY MANAGEMENT
        </div>
      </div>
    </div>
  );
}

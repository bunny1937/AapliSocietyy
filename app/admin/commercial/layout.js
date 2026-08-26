// app/admin/commercial/layout.js
//
// Dark mode is now driven globally by `data-theme` on <html> (see
// lib/theme/store.js, components/theme/ThemeToggle.jsx,
// styles/globals.css). `.commercial-scope`'s CSS custom properties inherit
// that attribute directly (app/admin/commercial/_ui/tokens.css's
// `:root[data-theme="dark"] .commercial-scope` selector) — no per-route
// wrapper attribute or local theme-store subscription is needed here
// anymore, so this layout is now a plain passthrough.
export default function CommercialLayout({ children }) {
  return children;
}

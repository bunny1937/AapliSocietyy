//app/layout.js
import { headers } from "next/headers";
import QueryProvider from "./providers/QueryProvider";
import "../styles/globals.css";
import { Inter } from "next/font/google";
import ToastProvider from "@/components/ui/ToastProvider";
import ConfirmDialogHost from "@/components/ui/ConfirmDialogHost";
const inter = Inter({ subsets: ["latin"] });
export const metadata = {
  title: "NexGen Society ERP",
  description: "Enterprise Society Management System",
};
// Runs before React hydrates, so the correct theme is on <html> before the
// very first paint — without this, the page would render light for a frame
// then flip to dark once lib/theme/store.js reads localStorage on mount.
// Wrapped in try/catch: private-mode/blocked localStorage falls back to
// light, matching lib/theme/store.js's own fallback.
const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var t=localStorage.getItem("app-theme");if(t==="dark")document.documentElement.setAttribute("data-theme","dark");}catch(e){}})();`;

export default async function RootLayout({ children }) {
  // Needed so this inline bootstrap script satisfies the app's own
  // nonce-based CSP (middleware.js) — an un-nonced inline <script> would
  // otherwise be blocked outright. middleware.js forwards its per-request
  // nonce on the "x-nonce" request header for exactly this case.
  const nonce = (await headers()).get("x-nonce") || undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className={inter.className}>
        <QueryProvider>{children}</QueryProvider>
        <ToastProvider />
        <ConfirmDialogHost />
      </body>
    </html>
  );
}

"use client";
import { Toaster } from "sonner";

// Premium dark toast theme — matches the app's existing dark admin palette
// (red #dc2626/#991b1b, green #059669/#10b981, amber #f59e0b, blue #2563eb),
// replaces window.alert()/window.confirm()/window.prompt() app-wide.
//
// Deliberately theme="dark" and hardcoded colors below, NOT var(--*) tokens:
// this toast skin is fixed-dark regardless of the app's own light/dark mode
// (same reasoning as the SuperAdminLayout sidebar and Logs.module.css
// terminal skin) — a light toast popping up over a dark-mode admin page (or
// vice versa) would look like a mismatched third-party widget, so it stays
// one consistent look in both themes.
export default function ToastProvider() {
  return (
    <Toaster
      theme="dark"
      position="top-right"
      richColors
      closeButton
      expand={false}
      gap={10}
      toastOptions={{
        duration: 4500,
        style: {
          background: "linear-gradient(180deg, #171717 0%, #111113 100%)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "12px",
          boxShadow: "0 8px 30px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.03) inset",
          color: "#f3f4f6",
          fontSize: "0.86rem",
          fontFamily: "inherit",
          padding: "12px 14px",
          backdropFilter: "blur(8px)",
        },
        classNames: {
          success: "app-toast-success",
          error: "app-toast-error",
          warning: "app-toast-warning",
          info: "app-toast-info",
        },
      }}
      style={{
        // Sonner CSS vars — tuned per-variant so each keeps the dark base
        // above but gets a colored left border + icon tint, not a solid
        // colored block (that's what read "cheap"/default-library, not premium).
        "--success-bg": "#111a15",
        "--success-border": "#1f6b4a",
        "--success-text": "#86efac",
        "--error-bg": "#1a1112",
        "--error-border": "#8f2f2f",
        "--error-text": "#fca5a5",
        "--warning-bg": "#1a160e",
        "--warning-border": "#8a6a1f",
        "--warning-text": "#fde68a",
        "--info-bg": "#0f1620",
        "--info-border": "#2a5a8f",
        "--info-text": "#93c5fd",
      }}
    />
  );
}

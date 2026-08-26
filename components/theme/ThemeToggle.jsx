// components/theme/ThemeToggle.jsx
//
// App-wide light/dark toggle — rendered permanently in every sidebar/header
// next to the notification bell (DashboardLayout.js for admin/member/
// security, SuperAdminLayout.js for superadmin). Previously this only
// existed on the 5 Commercial pages; promoted here so the whole app shares
// one toggle and one dark palette (styles/globals.css).
"use client";
import { useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { Sun, Moon } from "lucide-react";
import { subscribe, getSnapshot, getServerSnapshot, toggleTheme } from "@/lib/theme/store";

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const dark = theme === "dark";
  const [hover, setHover] = useState(false);

  const handleClick = (e) => {
    // Flood-fill transition, matching the reference _app.js implementation:
    // circle grows from the button's own center out past the full viewport
    // diagonal, with a soft glow drop-shadow riding along with the reveal.
    if (!document.startViewTransition) {
      toggleTheme(); // unsupported browser — instant swap, no animation
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const goingDark = !dark;

    // flushSync forces React to commit the theme change's DOM mutation
    // synchronously before this callback returns, which is what lets the
    // browser's "after" snapshot for the transition actually contain the
    // new theme — without it the snapshot can race React's (batched,
    // otherwise-async) re-render and briefly capture the old colors.
    const transition = document.startViewTransition(() => flushSync(() => toggleTheme()));
    transition.ready.then(() => {
      const radius = Math.hypot(window.innerWidth, window.innerHeight);

      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${radius}px at ${x}px ${y}px)`,
          ],
          filter: [
            goingDark
              ? "drop-shadow(0 0 25px rgba(255, 215, 0, 0.25))"
              : "drop-shadow(0 0 15px rgba(0, 0, 0, 0.15))",
            "none",
          ],
        },
        {
          duration: 1800,
          easing: "cubic-bezier(0.4, 0, 0.2, 1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={dark}
      title={dark ? "Light mode" : "Dark mode"}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 30, height: 30, borderRadius: 8, border: "1px solid var(--border)",
        cursor: "pointer", fontFamily: "inherit",
        background: hover ? "var(--primary-tint)" : "transparent",
        color: hover ? "var(--primary)" : "var(--fg-4)",
        transition: "background 0.15s ease, color 0.15s ease",
      }}
    >
      {dark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}

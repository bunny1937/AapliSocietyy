"use client";
import { useEffect, useId, useRef } from "react";

// Cloudflare's own script defines window.turnstile once loaded — shared
// across every widget instance on the page, so we only inject the <script>
// tag once no matter how many TurnstileWidget instances mount.
const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js";
let scriptLoadPromise = null;

function loadTurnstileScript() {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", reject);
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

/**
 * Managed-mode Cloudflare Turnstile checkbox. Renders itself once the
 * Cloudflare script is loaded, calls onVerify(token) when solved and
 * onExpire() if the token times out before the form is submitted (Turnstile
 * tokens are single-use and short-lived — a stale one must be re-solved).
 */
export default function TurnstileWidget({ onVerify, onExpire, onError }) {
  const containerId = useId().replace(/[:]/g, "");
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
          // Pinned light — this widget always sits inside .authCard
          // (styles/Auth.module.css), which is always a white card
          // regardless of app dark mode (see the comment on .authTitle
          // there). Default "auto" theme follows OS dark mode instead,
          // so a dark-mode OS was rendering Cloudflare's dark widget skin
          // inside a white card — visibly mismatched.
          theme: "light",
          callback: (token) => onVerify?.(token),
          "expired-callback": () => onExpire?.(),
          "error-callback": () => onError?.(),
        });
      })
      .catch((err) => {
        console.error("Failed to load Turnstile:", err);
        onError?.();
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div id={`turnstile-${containerId}`} ref={containerRef} />;
}

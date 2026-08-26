"use client";
// Global light/dark theme store — the whole app (admin, member, security,
// superadmin, commercial) shares this one instance, driven by `data-theme`
// on <html>. Opt-in only (persisted to localStorage), never automatic from
// OS prefers-color-scheme — see styles/globals.css's `:root[data-theme="dark"]`
// block for the actual color values this toggles between.

const STORAGE_KEY = "app-theme";
const VALID = new Set(["light", "dark"]);

function readStored() {
  if (typeof window === "undefined") return "light";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return VALID.has(v) ? v : "light";
  } catch {
    return "light"; // localStorage blocked (private mode, etc.) — default light
  }
}

// Read synchronously from the DOM attribute, which the no-FOUC bootstrap
// script in app/layout.js already set before hydration — so the store's
// very first snapshot matches what's on screen instead of always starting
// at "light" and flashing/flipping on mount.
function readInitial() {
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.getAttribute("data-theme");
  return VALID.has(attr) ? attr : "light";
}

let theme = readInitial();
const listeners = new Set();

function applyToDom(next) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", next);
}

function setTheme(next) {
  if (!VALID.has(next) || next === theme) return;
  theme = next;
  applyToDom(next);
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore — in-memory state still updates for this tab
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot() {
  return theme;
}

function getServerSnapshot() {
  return "light"; // must match the pre-hydration DOM default — no flash-of-wrong-theme mismatch warning
}

// Called once on mount to reconcile with localStorage (in case the
// no-FOUC script and localStorage ever disagree — they shouldn't, but this
// is the safety net) and to catch a value written by another tab.
function hydrateFromStorage() {
  const stored = readStored();
  if (stored !== theme) setTheme(stored);
}

function toggleTheme() {
  setTheme(theme === "dark" ? "light" : "dark");
}

export {
  subscribe,
  getSnapshot,
  getServerSnapshot,
  hydrateFromStorage,
  setTheme,
  toggleTheme,
};

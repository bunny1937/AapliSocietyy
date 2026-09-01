/**
 * §7.16 recent/frequent — shared localStorage helper so any page can record
 * "I looked at this" (not just QuickBar's own search results). Per-viewer
 * only, never reaches the server. Wrapped in try/catch throughout since a
 * private window or blocked site data makes these throw.
 */
const RECENTS_KEY = "accounting.quickbar.recents.v1";
const MAX_RECENTS = 6;

export function readRecents() {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function pushRecent(entry) {
  try {
    const list = readRecents().filter((r) => !(r.type === entry.type && r.id === entry.id));
    list.unshift(entry);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, MAX_RECENTS)));
  } catch { /* best-effort convenience, never blocks navigation */ }
}

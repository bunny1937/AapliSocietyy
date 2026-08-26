/**
 * Platform settings — editable at runtime, from the superadmin UI.
 *
 * ## Precedence
 *
 *   database row  >  environment variable  >  code default
 *
 * All three layers stay. The env var is not removed once a setting is editable
 * here, because it is the only layer that works before anything can reach
 * Mongo — a cold serverless instance, a script, a broken database. Deleting a
 * row is therefore "reset", not "unset": the value falls back through the
 * layers rather than becoming undefined.
 *
 * ## Why the accessors stay synchronous
 *
 * `GRACE_MIN_DAYS()` and friends are called from validators buried inside
 * request handling. Making them async would mean threading `await` through
 * every caller of every validator, and a validator that can fail on a network
 * hiccup is a worse thing than a setting that takes a minute to propagate.
 *
 * So the values live in a process-level cache, refreshed by an explicit
 * `await ensureSettings()` at the top of the routes that care. Read a setting
 * without that and you get the env-or-default value, which is exactly what the
 * code did before this file existed — the failure mode is "yesterday's value",
 * never a crash and never undefined.
 *
 * ## Propagation
 *
 * Each serverless instance holds its own cache with a 60-second freshness
 * window, so a change reaches every instance within a minute. That is slower
 * than a push and enormously simpler, and none of these settings is the kind
 * where sixty seconds matters — they govern windows measured in days.
 */

export const TYPE = { INT: "int", BOOL: "bool", EMAIL: "email", LIST: "list" };

/**
 * The registry. A setting that is not here cannot be edited, cannot be read,
 * and a stale database row for it is ignored.
 *
 * @property key            the setting id and the database row key
 * @property env            the environment variable it falls back to
 * @property fallback       the code default, used when neither is set
 * @property group          how the UI files it
 * @property label          human name
 * @property why            what it does, and what happens at the extremes
 * @property min/max        bounds for INT, enforced on write
 * @property reasonRequired true for settings that widen a limit or disable a
 *                          safety — those cost a written reason
 * @property restartNote    set when a change does NOT take effect immediately
 */
export const SETTINGS = [
  // ── Offboarding: the grace window ───────────────────────────────────
  {
    key: "SOCIETY_GRACE_MIN_DAYS",
    env: "SOCIETY_GRACE_MIN_DAYS",
    type: TYPE.INT,
    fallback: 7,
    min: 1,
    max: 90,
    group: "Offboarding — grace window",
    label: "Minimum grace (days)",
    why: "The floor on how soon a soft-deleted society can be purged. A week is enough for the handover email to arrive, be read by somebody who checks that inbox weekly, and be acted on. Lowering this shortens the only window a society has to notice.",
  },
  {
    key: "SOCIETY_GRACE_DEFAULT_DAYS",
    env: "SOCIETY_GRACE_DEFAULT_DAYS",
    type: TYPE.INT,
    fallback: 30,
    min: 1,
    max: 365,
    group: "Offboarding — grace window",
    label: "Default grace (days)",
    why: "What the delete wizard prefills. 30 days matches the common notice period in the Model Bye-laws and is long enough that a monthly-meeting cadence gets one chance to look at it.",
  },
  {
    key: "SOCIETY_GRACE_MAX_DAYS",
    env: "SOCIETY_GRACE_MAX_DAYS",
    type: TYPE.INT,
    fallback: 180,
    min: 7,
    max: 365,
    group: "Offboarding — grace window",
    label: "Maximum grace (days)",
    why: "The ceiling without a per-society extension. Past six months it is not a wind-down, it is storage — and it should be an active account or nothing.",
  },
  {
    key: "SOCIETY_GRACE_ABSOLUTE_MAX_DAYS",
    env: "SOCIETY_GRACE_ABSOLUTE_MAX_DAYS",
    type: TYPE.INT,
    fallback: 365,
    min: 30,
    max: 730,
    group: "Offboarding — grace window",
    label: "Absolute maximum (days)",
    why: "The hard stop on a per-society extension. Past a year it is not a wind-down under any reading — the society should be an active account again, or gone.",
    reasonRequired: true,
  },

  // ── Offboarding: safety ─────────────────────────────────────────────
  {
    key: "SOCIETY_PURGE_ENABLED",
    env: "SOCIETY_PURGE_ENABLED",
    type: TYPE.BOOL,
    fallback: true,
    group: "Offboarding — safety",
    label: "Society purging enabled",
    why: "The platform kill switch. Turned off, the nightly purge still runs and still reports success — it simply erases nothing. A brake, not an accelerator: turning it on enables nothing by itself, every other gate still applies.",
    reasonRequired: true,
  },
  {
    key: "SOCIETY_BREAK_GLASS_ADMINS",
    env: "SOCIETY_BREAK_GLASS_ADMINS",
    type: TYPE.LIST,
    fallback: [],
    group: "Offboarding — safety",
    label: "Break-glass admins",
    why: "Who may export a society onto their own machine, delete one immediately, or waive the collection gate. User ids or email addresses. Empty means nobody — it fails closed, and empty is the correct state until the day it is needed. Deliberately not a role, because roles drift: somebody made a superadmin for an unrelated reason should not silently inherit the power to erase a society.",
    reasonRequired: true,
  },
  {
    key: "SOCIETY_HANDOVER_MAX_REMINDERS",
    env: "SOCIETY_HANDOVER_MAX_REMINDERS",
    type: TYPE.INT,
    fallback: 6,
    min: 1,
    max: 26,
    group: "Offboarding — safety",
    label: "Handover reminders before giving up",
    why: "How many weekly chases a society gets before the reminder cron stops. Past this, purge gate 6 can only be cleared by a break-glass waiver. Setting it to 1 means a single missed email ends the chasing.",
  },

  // ── Retention ───────────────────────────────────────────────────────
  {
    key: "TENANCY_DOCUMENT_RETENTION_DAYS",
    env: "TENANCY_DOCUMENT_RETENTION_DAYS",
    type: TYPE.INT,
    fallback: 1095,
    min: 90,
    max: 3650,
    group: "Retention",
    label: "Tenancy document retention (days)",
    why: "How long a finished tenancy's documents survive after the lease ends. Three years covers the usual dispute window. Note that shortening this only affects documents not yet marked — an expiry already stamped is never extended, by design.",
  },

  // ── Alerting ────────────────────────────────────────────────────────
  {
    key: "ENTITLEMENT_ALERT_EMAIL",
    env: "ENTITLEMENT_ALERT_EMAIL",
    type: TYPE.EMAIL,
    fallback: "",
    group: "Alerting",
    label: "Alert recipient",
    why: "Where cron failure alerts, the cron watchdog, module denial alerts and the weekly blocked-society digest all go. Unset, every one of them is skipped silently — including the alert that would tell you alerts are broken. Falls back to SUPER_ADMIN_EMAIL.",
  },
  {
    key: "ENTITLEMENT_ALERT_MIN_DENIALS",
    env: "ENTITLEMENT_ALERT_MIN_DENIALS",
    type: TYPE.INT,
    fallback: 10,
    min: 1,
    max: 1000,
    group: "Alerting",
    label: "Denials before alerting",
    why: "How many refused requests from one society in an hour trigger a sales alert. Too low and a member with a stale bookmark generates a phone call; too high and genuine interest goes unnoticed.",
  },
  {
    key: "ENTITLEMENT_ALERT_MIN_MODULES",
    env: "ENTITLEMENT_ALERT_MIN_MODULES",
    type: TYPE.INT,
    fallback: 3,
    min: 1,
    max: 6,
    group: "Alerting",
    label: "Distinct modules before alerting",
    why: "The other trigger: somebody trying three different locked modules is exploring, whatever the count. Either threshold alone is enough to alert.",
  },

  // ── Subscription lifecycle ──────────────────────────────────────────
  {
    key: "SUBSCRIPTION_GRACE_DAYS",
    env: "SUBSCRIPTION_GRACE_DAYS",
    type: TYPE.INT,
    fallback: 3,
    min: 0,
    max: 30,
    group: "Subscription lifecycle",
    label: "Grace period (days)",
    why: "How long after a lapse a society keeps full access with only a banner. Day 0 to this number. Setting it to 0 means a lapsed society is read-only the same day, with no warning period at all.",
  },
  {
    key: "SUBSCRIPTION_RESTRICTED_DAYS",
    env: "SUBSCRIPTION_RESTRICTED_DAYS",
    type: TYPE.INT,
    fallback: 8,
    min: 1,
    max: 90,
    group: "Subscription lifecycle",
    label: "Read-only until day",
    why: "The day a society moves from read-only to fully blocked. Must be greater than the grace period. Members keep reading their own records even past this — they did not fail to pay.",
  },
];

export const SETTING_KEYS = SETTINGS.map((s) => s.key);
export const settingDef = (key) => SETTINGS.find((s) => s.key === key) || null;

// ── the cache ─────────────────────────────────────────────────────────

const FRESH_FOR_MS = 60 * 1000;
let cache = new Map();
let loadedAt = 0;

/**
 * Replace the override cache. Called only by lib/platform/settingsStore.js,
 * which owns the database read.
 *
 * The split is not stylistic. lib/entitlements/lifecycle.js and denials.js
 * read settings, and both are imported by middleware.js, which runs on the
 * EDGE runtime. Anything reachable from this file — including through a
 * dynamic import(), which webpack still traces — ends up in the edge bundle,
 * and a mongoose import there drags in node:dns and fails the build outright.
 *
 * So this file stays pure: registry, coercion, validation, and a cache
 * somebody else fills. The edge reads through the env-or-default fallback,
 * which is exactly what it did before this file existed.
 */
export function _applyOverrides(map) {
  cache = map instanceof Map ? map : new Map(Object.entries(map || {}));
  loadedAt = Date.now();
}

/** True when the cache is inside its freshness window. */
export function settingsFresh(force = false) {
  return !force && Date.now() - loadedAt < FRESH_FOR_MS;
}

/** Marks the cache loaded without changing it — used when the DB read fails. */
export function _markLoaded() {
  loadedAt = Date.now();
}

/** Drop the cache so the next ensureSettings() re-reads. Called after a write. */
export function invalidateSettings() {
  loadedAt = 0;
}

/**
 * Read a setting. Synchronous by design — see the note at the top.
 *
 * Falls through database → env → code default, so this never throws and never
 * returns undefined for a registered key.
 */
export function setting(key) {
  const def = settingDef(key);
  if (!def) throw new Error(`Unknown setting: ${key}`);

  if (cache.has(key)) {
    const coerced = coerce(def, cache.get(key));
    if (coerced !== null) return coerced;
  }

  const raw = process.env[def.env];
  if (raw !== undefined && raw !== "") {
    const coerced = coerce(def, raw);
    if (coerced !== null) return coerced;
  }

  return def.fallback;
}

/** Where a setting's current value came from — shown in the UI. */
export function settingSource(key) {
  const def = settingDef(key);
  if (!def) return "unknown";
  if (cache.has(key) && coerce(def, cache.get(key)) !== null) return "database";
  const raw = process.env[def.env];
  if (raw !== undefined && raw !== "" && coerce(def, raw) !== null) return "environment";
  return "default";
}

/** Coerce a stored or env value to the setting's type. null = unusable. */
export function coerce(def, raw) {
  if (raw === undefined || raw === null) return null;

  switch (def.type) {
    case TYPE.INT: {
      const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
      return Number.isFinite(n) ? n : null;
    }
    case TYPE.BOOL: {
      if (typeof raw === "boolean") return raw;
      const s = String(raw).trim().toLowerCase();
      // Deliberately explicit rather than truthiness: SOCIETY_PURGE_ENABLED is
      // documented as "the string false disables it", and a typo like "flase"
      // must not silently read as enabled.
      if (["true", "1", "yes", "on", "enabled"].includes(s)) return true;
      if (["false", "0", "no", "off", "disabled"].includes(s)) return false;
      return null;
    }
    case TYPE.EMAIL: {
      const s = String(raw).trim().toLowerCase();
      if (!s) return null;
      return s.includes("@") ? s : null;
    }
    case TYPE.LIST: {
      const list = Array.isArray(raw) ? raw : String(raw).split(",");
      const cleaned = list.map((v) => String(v).trim()).filter(Boolean);
      return cleaned;
    }
    default:
      return null;
  }
}

/**
 * Validate a value a superadmin is trying to save.
 * @returns { ok: true, value } | { ok: false, error }
 */
export function validateSetting(key, raw) {
  const def = settingDef(key);
  if (!def) return { ok: false, error: `Unknown setting: ${key}` };

  const value = coerce(def, raw);
  if (value === null) {
    return { ok: false, error: `${def.label} is not a valid ${def.type}.` };
  }

  if (def.type === TYPE.INT) {
    if (def.min !== undefined && value < def.min) {
      return { ok: false, error: `${def.label} cannot be below ${def.min}.` };
    }
    if (def.max !== undefined && value > def.max) {
      return { ok: false, error: `${def.label} cannot be above ${def.max}.` };
    }
  }

  return { ok: true, value };
}

/**
 * Cross-field rules — the ones a per-field range check cannot catch.
 *
 * Each of these is a combination that is individually legal and jointly
 * incoherent, and every one of them would fail silently rather than loudly:
 * a floor above a ceiling does not throw, it just makes every date invalid.
 *
 * @param pending  { key: value } about to be applied, merged over current
 * @returns array of error strings, empty when consistent
 */
export function settingsConflicts(pending = {}) {
  const val = (key) => (key in pending ? pending[key] : setting(key));
  const errors = [];

  const min = val("SOCIETY_GRACE_MIN_DAYS");
  const def = val("SOCIETY_GRACE_DEFAULT_DAYS");
  const max = val("SOCIETY_GRACE_MAX_DAYS");
  const abs = val("SOCIETY_GRACE_ABSOLUTE_MAX_DAYS");

  if (min > max) {
    errors.push(`Minimum grace (${min}) is above the maximum (${max}) — no date would be valid.`);
  }
  if (def < min || def > max) {
    errors.push(`Default grace (${def}) is outside the ${min}–${max} range the wizard would accept.`);
  }
  if (abs < max) {
    errors.push(
      `Absolute maximum (${abs}) is below the standard maximum (${max}) — an extension would be capped lower than the limit it exists to raise.`,
    );
  }

  const grace = val("SUBSCRIPTION_GRACE_DAYS");
  const restricted = val("SUBSCRIPTION_RESTRICTED_DAYS");
  if (restricted <= grace) {
    errors.push(
      `Read-only day (${restricted}) must be after the grace period (${grace}) — otherwise a society goes from full access straight to blocked with no read-only stage.`,
    );
  }

  return errors;
}

/** Everything the settings UI needs, in one shape. */
export function settingsSnapshot() {
  return SETTINGS.map((def) => ({
    key: def.key,
    env: def.env,
    type: def.type,
    label: def.label,
    why: def.why,
    group: def.group,
    min: def.min ?? null,
    max: def.max ?? null,
    fallback: def.fallback,
    reasonRequired: Boolean(def.reasonRequired),
    value: setting(def.key),
    source: settingSource(def.key),
  }));
}

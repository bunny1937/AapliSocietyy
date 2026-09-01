/**
 * ============================================================================
 * AapliSociety RBAC — Permission Registry
 * ============================================================================
 * In-memory, boot-time registry built from the canonical catalog. It is the
 * runtime authority for:
 *   - which permission ids exist
 *   - which are "dangerous" (for ⚠ UI indicators)
 *   - which are page-access permissions (for CI "no page without a permission")
 *   - wildcard expansion (module.* / module.resource.* -> concrete leaves)
 *
 * EXTENSIBILITY (Q14): future modules/plugins self-register WITHOUT touching
 * the engine. At boot a plugin calls:
 *
 *     import { registry } from "@/lib/rbac/registry";
 *     registry.registerModule(myModuleDef);
 *
 * Duplicate ids, bad formats, and global "*" are rejected fail-fast at boot.
 * ============================================================================
 */

import { PERMISSION_CATALOG } from "./permissions-catalog.js";

// Segments are camelCase identifiers: start lowercase, then letters/digits.
// (Resource/action keys such as "generatedBills", "viewSelf", "guardAdmit".)
const ID_RE = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;

class PermissionRegistry {
  constructor() {
    /** @type {Map<string, {id:string,module:string,resource:string,action:string,label:string,dangerous:boolean,page:boolean,path:string|null}>} */
    this.permissions = new Map();
    /** @type {Map<string, object>} module.key -> ModuleDef (for the picker tree) */
    this.modules = new Map();
    this._frozen = false;
  }

  /** Register one module definition (catalog entry OR plugin). Idempotent per id. */
  registerModule(mod) {
    if (this._frozen) {
      throw new Error(
        `[rbac] registry is frozen; registerModule("${mod?.key}") called too late`,
      );
    }
    if (!mod || !mod.key)
      throw new Error("[rbac] module definition missing 'key'");
    if (this.modules.has(mod.key)) {
      throw new Error(`[rbac] duplicate module "${mod.key}"`);
    }
    this.modules.set(mod.key, mod);

    for (const resource of mod.resources || []) {
      for (const action of resource.actions || []) {
        const id = `${mod.key}.${resource.key}.${action.key}`;
        if (!ID_RE.test(id)) {
          throw new Error(
            `[rbac] invalid permission id "${id}" (must match module.resource.action)`,
          );
        }
        if (this.permissions.has(id)) {
          throw new Error(`[rbac] duplicate permission id "${id}"`);
        }
        this.permissions.set(id, {
          id,
          module: mod.key,
          resource: resource.key,
          action: action.key,
          label: action.label || action.key,
          dangerous: !!action.dangerous,
          page: !!resource.page && action.key === "view",
          path: resource.page ? resource.path || null : null,
        });
      }
    }
    return this;
  }

  /** Prevent further registration after boot (called once by boot()). */
  freeze() {
    this._frozen = true;
    return this;
  }

  has(id) {
    return this.permissions.has(id);
  }

  isDangerous(id) {
    return this.permissions.get(id)?.dangerous === true;
  }

  /** The full descriptor for one leaf id, or undefined. */
  get(id) {
    return this.permissions.get(id);
  }

  /** @returns {string[]} every concrete leaf permission id */
  allIds() {
    return [...this.permissions.keys()];
  }

  /** @returns {Array} every page-access permission {id, path, module} */
  pagePermissions() {
    return [...this.permissions.values()].filter((p) => p.page);
  }

  /** Map a route path -> its page-access permission id (or null). */
  pagePermissionForPath(path) {
    const hit = [...this.permissions.values()].find(
      (p) => p.page && p.path === path,
    );
    return hit ? hit.id : null;
  }

  /**
   * Expand an authoring token to concrete leaf ids.
   *   "billing.*"          -> all billing leaves
   *   "billing.bill.*"     -> all billing.bill leaves
   *   "billing.bill.view"  -> itself (if it exists)
   * Unknown/deprecated ids are dropped (fail-closed).
   */
  expand(token) {
    if (!token || token === "*") return []; // no global wildcard, ever
    if (this.permissions.has(token)) return [token];
    const parts = token.split(".");
    if (parts.length === 2 && parts[1] === "*") {
      const [mod] = parts;
      return this.allIds().filter((id) => id.startsWith(`${mod}.`));
    }
    if (parts.length === 3 && parts[2] === "*") {
      const [mod, res] = parts;
      return this.allIds().filter((id) => id.startsWith(`${mod}.${res}.`));
    }
    return []; // unknown / deprecated leaf -> ignored
  }

  /** Expand + de-dupe a list of authoring tokens. */
  expandMany(tokens = []) {
    const out = new Set();
    for (const t of tokens) for (const id of this.expand(t)) out.add(id);
    return [...out];
  }

  /** The picker tree (modules -> resources -> actions) with dangerous flags. */
  tree() {
    return [...this.modules.values()].map((mod) => ({
      key: mod.key,
      label: mod.label,
      resources: (mod.resources || []).map((r) => ({
        key: r.key,
        label: r.label,
        page: !!r.page,
        path: r.path || null,
        actions: (r.actions || []).map((a) => ({
          id: `${mod.key}.${r.key}.${a.key}`,
          key: a.key,
          label: a.label || a.key,
          dangerous: !!a.dangerous,
        })),
      })),
    }));
  }
}

// Singleton, seeded from the canonical catalog at import time.
export const registry = new PermissionRegistry();

let _booted = false;
/** Idempotent boot: seed catalog + (later) plugin modules, then freeze. */
export function bootRegistry(pluginModules = []) {
  if (_booted) return registry;
  for (const mod of PERMISSION_CATALOG) registry.registerModule(mod);
  for (const mod of pluginModules) registry.registerModule(mod);
  registry.freeze();
  _booted = true;
  return registry;
}

// Seed immediately so imports that don't call bootRegistry() still work in
// serverless route handlers. Plugins that need to register must import and call
// registry.registerModule BEFORE first use; see docs/RBAC-PLUGINS.md.
for (const mod of PERMISSION_CATALOG) {
  if (!registry.modules.has(mod.key)) registry.registerModule(mod);
}

export default registry;

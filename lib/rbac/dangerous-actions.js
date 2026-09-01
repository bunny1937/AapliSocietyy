/**
 * AapliSociety RBAC — which pages hand over irreversible power at MANAGE
 * ============================================================================
 * SERVER ONLY. Imports the registry, which pulls the whole permission catalog;
 * page-access-map.js deliberately stays free of that import because the client
 * bundles it (RoleManager needs reduceToPageAccess) and the admin-facing UI is
 * built on pages and levels, never on permission ids.
 *
 * ## The gap this closes
 *
 * permissions-catalog.js has marked destructive actions `dangerous: true`
 * since it was written — delete, export, reset, purge — and registry.js
 * carries the flag through faithfully. Nothing ever read it. The flag existed
 * for "the admin picker" that the simplified page model replaced, and when the
 * picker went the flag had nowhere left to surface.
 *
 * So the admin choosing between No access / View only / Manage sees three
 * identical-looking buttons whether the page is Notices or View Members. One
 * of those MANAGE grants includes deleting members and exporting every
 * resident's contact details. The person clicking cannot tell, and the cost of
 * not telling them is paid by the residents.
 *
 * This does not block anything. It says what is behind the button.
 *
 * ## Why manage-beyond-view only
 *
 * Several pages (Visitors, Visitor Log, Receipts) list identical view and
 * manage ids — MANAGE grants nothing VIEW did not. Counting those ids would
 * mark such a page dangerous at a level that hands over no new power, which is
 * both wrong and the exact trap levelFor() in page-access-map.js already
 * documents. Same rule, same reason.
 * ============================================================================
 */

import { PAGE_ACCESS_MAP } from "./page-access-map.js";
import { registry } from "./registry.js";

/**
 * The destructive actions a page's MANAGE level would hand over.
 *
 * @param {string} pageKey
 * @returns {{ id: string, label: string }[]} empty when the page is harmless
 */
export function dangerousActionsForPage(pageKey) {
  const entry = PAGE_ACCESS_MAP[pageKey];
  if (!entry) return [];
  const { view = [], manage = [] } = entry;
  const viewSet = new Set(view);
  return manage
    .filter((id) => !viewSet.has(id) && registry.isDangerous(id))
    .map((id) => ({ id, label: registry.get(id)?.label || id }));
}

/** Every page that carries at least one destructive action, keyed by page. */
export function dangerousActionsByPage() {
  const out = {};
  for (const pageKey of Object.keys(PAGE_ACCESS_MAP)) {
    const actions = dangerousActionsForPage(pageKey);
    if (actions.length) out[pageKey] = actions;
  }
  return out;
}

export default dangerousActionsForPage;

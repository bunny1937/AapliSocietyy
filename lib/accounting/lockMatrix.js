/**
 * The lock matrix for Chart of Accounts heads — design doc §7, "The lock
 * matrix for heads". SERVER ONLY.
 *
 * Four conditions, checked in the order the doc lists them (most binding
 * first), because an account can satisfy more than one — a head that's both
 * fiscal-mapped AND has journal lines is governed by the fiscal-mapping row,
 * the stricter of the two. First match wins.
 *
 * Tiers, per design doc §7:
 *   T0  no friction
 *   T1  show consequences, then do it (inline impact + Confirm)
 *   T2  typed confirmation + mandatory reason
 *   T3  refused outright — reason + the correct path, never a bare "no"
 */

const ROWS = [
  {
    // Mapped in fiscal config (7 heads)
    test: (ctx) => ctx.mappedInFiscalConfig,
    tiers: { delete: "T3", deactivate: "T3", rename: "T0", changeCode: "T3", changeTypeOrSchedule: "T3" },
  },
  {
    // Referenced by a posting rule resolver (fiscal mapping OR a BillingHead
    // linked-account pointing at it — see lib/accounting/postingRules/accountResolvers.js)
    test: (ctx) => ctx.referencedByPostingRule,
    tiers: { delete: "T3", deactivate: "T2", rename: "T0", changeCode: "T3", changeTypeOrSchedule: "T2" },
  },
  {
    // Has journal lines
    test: (ctx) => ctx.hasJournalLines,
    tiers: { delete: "T3", deactivate: "T1", rename: "T0", changeCode: "T3", changeTypeOrSchedule: "T2" },
  },
  {
    // Adopted, never posted to — the default row for any other active account
    test: () => true,
    tiers: { delete: "T2", deactivate: "T1", rename: "T0", changeCode: "T1", changeTypeOrSchedule: "T1" },
  },
];

/**
 * @param {{mappedInFiscalConfig:boolean, referencedByPostingRule:boolean, hasJournalLines:boolean}} ctx
 * @returns {{delete:string, deactivate:string, rename:string, changeCode:string, changeTypeOrSchedule:string, reason:string}}
 */
export function computeLockLevel(ctx) {
  const row = ROWS.find((r) => r.test(ctx));
  return {
    ...row.tiers,
    reason: reasonFor(ctx),
  };
}

function reasonFor(ctx) {
  if (ctx.mappedInFiscalConfig) return "This head is mapped in the fiscal configuration — payments and bills post through it by name.";
  if (ctx.referencedByPostingRule) return "A posting rule or billing head points at this account by id.";
  if (ctx.hasJournalLines) return `${ctx.journalLineCount || "Some"} journal line(s) reference this account.`;
  return "Adopted but never posted to.";
}

/**
 * T3-refusal copy, per the doc's "T3 copy rule": what you tried · why it
 * can't · what to do instead. Returns null when the action isn't actually T3
 * for this account (caller should proceed to its normal T0-T2 path instead).
 */
export function t3Refusal(action, account, ctx) {
  const level = computeLockLevel(ctx);
  if (level[action] !== "T3") return null;

  if (action === "delete" || action === "deactivate") {
    if (ctx.mappedInFiscalConfig) {
      return {
        title: `"${account.name}" can't be ${action === "delete" ? "deleted" : "deactivated"}.`,
        reason: "It is mapped in the fiscal configuration — the system posts payments and bills through it by name.",
        remedy: "Change the fiscal mapping first, then this head is free.",
        remedyHref: "/admin/accounting/setup",
      };
    }
    if (ctx.referencedByPostingRule) {
      return {
        title: `"${account.name}" can't be ${action === "delete" ? "deleted" : "deactivated"}.`,
        reason: "A posting rule or billing head points at this account.",
        remedy: "Repoint the reference first.",
        remedyHref: "/admin/accounting/posting-rules",
      };
    }
    if (ctx.hasJournalLines) {
      return {
        title: `"${account.name}" can't be deleted.`,
        reason: `${ctx.journalLineCount} journal entr${ctx.journalLineCount === 1 ? "y" : "ies"} reference it — removing it would rewrite posted history.`,
        remedy: "Deactivate instead — it stays for the record but stops accepting new entries.",
        remedyHref: null,
      };
    }
  }
  if (action === "changeCode" || action === "changeTypeOrSchedule") {
    return {
      title: `"${account.name}"'s ${action === "changeCode" ? "code" : "type or schedule"} can't be changed.`,
      reason: reasonFor(ctx),
      remedy: "Use a new account instead, or clear the reference first.",
      remedyHref: null,
    };
  }
  return { title: `"${account.name}" can't be changed that way.`, reason: reasonFor(ctx), remedy: "", remedyHref: null };
}

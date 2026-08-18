/**
 * ============================================================================
 * AapliSociety RBAC — System Role Factory Defaults
 * ============================================================================
 * System roles are PROTECTED EDITABLE TEMPLATES (Decision Q4):
 *   - identity (key + name) is LOCKED and non-deletable
 *   - permission SET is editable per society
 *   - "Restore factory permissions" resets a society's template copy back to
 *     the code-defined defaults below (rbac.role.restoreDefaults)
 *
 * These defaults are authored as WILDCARD tokens for readability; they are
 * expanded to concrete leaves by the registry on seed/save. Editing here only
 * affects NEW seeds and the "restore defaults" action — never silently mutates
 * a society that already customized its templates.
 *
 * MEMBER is intentionally NOT a template here — members are a fixed capability
 * set (Decision #3) resolved by the permission engine, not admin-composable.
 * ============================================================================
 */

import { expandPageAccess } from "./page-access-map.js";

/**
 * Templates are authored as page:level pairs — the exact shape the "Roles &
 * Access" wizard itself produces (master plan §16/§18: spoon-fed, no raw
 * permission ids). `expandPageAccess` turns each into the concrete leaf ids
 * the engine actually checks, at module load, so nothing downstream
 * (role-service, seed-roles.js) needs to know templates changed shape.
 */
function pages(pairs) {
  return expandPageAccess(
    Object.entries(pairs).map(([pageKey, level]) => ({ pageKey, level })),
  );
}

/** @type {{ key:string, name:string, description:string, color:string, permissions:string[] }[]} */
export const SYSTEM_ROLE_DEFAULTS = [
  {
    key: "admin",
    name: "Admin",
    description: "Full administrative control of the society.",
    color: "red",
    // Superuser short-circuit (permission-engine.js) grants everything at
    // resolve time regardless of this list — kept as wildcards for the rare
    // caller that reads Role.permissions directly instead of resolving.
    permissions: [
      "dashboard.*",
      "billing.*",
      "finance.*",
      "member.*",
      "complaint.*",
      "notice.*",
      "visitor.*",
      "security.*",
      "society.*",
      "audit.*",
      "rbac.*",
      "statements.*",
      "commercial.*",
      "amenities.*",
    ],
  },
  {
    // The role the brief calls "Clubhouse Manager". Seeded as a protected
    // template like Secretary/Security so an Admin can assign it immediately
    // instead of hand-building the same permission set in every society — and,
    // like every other template here, its permission SET stays editable.
    //
    // Operations only. No amenities.admin.* (that is the configuration page),
    // no capacity, no RBAC, no financial pages. The `amenities` admin page is
    // deliberately NOT granted: this role's home is the mobile environment.
    key: "clubhouseManager",
    name: "Clubhouse Manager",
    description:
      "Runs the clubhouse day to day from the mobile app: scan residents in, attendance, open/close, timings, maintenance, incidents.",
    color: "teal",
    permissions: pages({
      clubhouseOps: "manage",
    }),
  },
  {
    key: "secretary",
    name: "Secretary",
    description:
      "Day-to-day society operations: members, notices, complaints, visitors.",
    color: "blue",
    permissions: pages({
      dashboard: "view",
      viewMembers: "manage",
      importMembers: "manage",
      tenantRequests: "manage",
      profileEditRequests: "manage",
      notices: "manage",
      complaints: "manage",
      visitors: "manage",
      visitorsActive: "view",
      visitorsLog: "view",
      visitorsAudit: "view",
      securityGuards: "manage",
      blacklist: "manage",
      ledger: "view",
      payments: "view",
      receipts: "view",
      viewBills: "view",
      generatedBills: "view",
      generateBills: "view",
      auditReport: "view",
    }),
  },
  {
    key: "accountant",
    // Display name matches the master-plan template ("Treasurer"); the key
    // stays "accountant" — it's what seed-roles.js/bootstrap already map
    // legacy User.role:"Accountant" onto, and role keys are identity-locked.
    name: "Treasurer",
    description: "Finance, billing, payments, ledger and statements.",
    color: "green",
    permissions: pages({
      dashboard: "view",
      billTemplate: "manage",
      importBills: "manage",
      billingConfig: "manage",
      viewBills: "manage",
      generateBills: "manage",
      generatedBills: "manage",
      balanceSheet: "manage",
      ledger: "manage",
      payments: "manage",
      receipts: "manage",
      latePayment: "manage",
      expenditure: "manage",
      paymentsReceived: "manage",
      openingBalances: "manage",
      generateStatements: "manage",
      incomeExpenditure: "manage",
      assetsLiabilities: "manage",
      otherStatements: "manage",
      viewMembers: "view",
      auditReport: "view",
    }),
  },
  {
    key: "auditor",
    name: "Auditor",
    description: "Read-only access to finance, billing and audit records.",
    color: "purple",
    permissions: pages({
      dashboard: "view",
      viewBills: "view",
      generatedBills: "view",
      balanceSheet: "view",
      ledger: "view",
      payments: "view",
      receipts: "view",
      latePayment: "view",
      expenditure: "view",
      openingBalances: "view",
      generateStatements: "view",
      incomeExpenditure: "view",
      assetsLiabilities: "view",
      otherStatements: "view",
      auditReport: "view",
    }),
  },
  {
    key: "committeeMember",
    name: "Committee Member",
    description: "Broad read access across the society with limited management.",
    color: "teal",
    permissions: pages({
      dashboard: "view",
      viewMembers: "view",
      tenantRequests: "view",
      profileEditRequests: "view",
      viewBills: "view",
      generatedBills: "view",
      balanceSheet: "view",
      ledger: "view",
      payments: "view",
      receipts: "view",
      notices: "manage",
      complaints: "view",
      visitors: "view",
      auditReport: "view",
    }),
  },
  {
    key: "security",
    name: "Security",
    description: "Gate operations: visitor entry/exit, passes and SOS.",
    color: "orange",
    permissions: [
      "visitor.gate.view",
      "visitor.active.view",
      "visitor.log.view",
      "visitor.visitor.view",
      "visitor.visitor.enter",
      "visitor.visitor.exit",
      "visitor.visitor.approve",
      "visitor.visitor.extend",
      "visitor.visitor.offlineEntry",
      "visitor.visitor.guardAdmit",
      "visitor.visitor.sos",
      "visitor.pass.view",
      "visitor.pass.verify",
      "visitor.blacklist.view",
      "rbac.myAccess.view",
    ],
  },
];

/**
 * MEMBER fixed capability set (Decision #3). Resolved by the engine for the
 * member "hat". Ownership scoping (own flat only) is enforced at the data layer
 * (lib/rbac/tenant-repository.js + per-route owner checks), not by these ids.
 */
export const MEMBER_CAPABILITIES = [
  "rbac.myAccess.view",
  "member.profile.viewSelf",
  "member.profile.updateSelf",
  "billing.bill.view",
  "billing.bill.download",
  "finance.receipt.view",
  "finance.receipt.download",
  "finance.ledger.view",
  "finance.payment.record",
  "complaint.complaint.view",
  "complaint.complaint.create",
  "complaint.complaint.reply",
  "notice.notice.view",
  "visitor.visitor.approve",
  "visitor.pass.view",
  "visitor.pass.create",
];

export const SYSTEM_ROLE_KEYS = SYSTEM_ROLE_DEFAULTS.map((r) => r.key);

export function getSystemRoleDefault(key) {
  return SYSTEM_ROLE_DEFAULTS.find((r) => r.key === key) || null;
}

export default SYSTEM_ROLE_DEFAULTS;

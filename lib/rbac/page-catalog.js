/**
 * AapliSociety RBAC — Page Catalog (simplified model)
 * Every admin/management page = one entry. Access is NONE / VIEW / MANAGE.
 * No per-action CRUD ids, no wildcards, no denies. This is the single
 * source of truth consumed by permission-engine.js, authorize(), the
 * sidebar filter, and the Roles & Access wizard.
 */

/** @typedef {{ key:string, label:string, path:string, group:string, adminOnly?:boolean }} PageDef */

/** @type {PageDef[]} */
export const PAGE_CATALOG = [
  // ── Overview ──────────────────────────────────────────────────────────
  { key: "dashboard", label: "Dashboard", path: "/admin/dashboard", group: "Overview" },

  // ── Society ───────────────────────────────────────────────────────────
  { key: "societyConfig", label: "Society Settings", path: "/admin/society-config", group: "Society" },
  { key: "databaseManager", label: "Database Manager", path: "/admin/database-manager", group: "Society" },
  { key: "viewMembers", label: "View Members", path: "/admin/view-members", group: "Society" },
  { key: "importMembers", label: "Import Members", path: "/admin/import-members", group: "Society" },
  { key: "tenantRequests", label: "Tenant Requests", path: "/admin/tenant-requests", group: "Society" },
  { key: "profileEditRequests", label: "Profile Change Requests", path: "/admin/profile-edit-requests", group: "Society" },

  // ── Billing ───────────────────────────────────────────────────────────
  { key: "billTemplate", label: "Bill Template", path: "/admin/bill-template", group: "Billing" },
  { key: "importBills", label: "Import Bills", path: "/admin/import-bills", group: "Billing" },
  { key: "billingConfig", label: "Billing Configuration", path: "/admin/billing-config", group: "Billing" },
  { key: "viewBills", label: "View Bills", path: "/admin/view-bills", group: "Billing" },
  { key: "generateBills", label: "Generate Bills", path: "/admin/generate-bills", group: "Billing" },
  { key: "generatedBills", label: "Generated Bills", path: "/admin/generated-bills", group: "Billing" },
  { key: "balanceSheet", label: "Balance Sheet", path: "/admin/balance-sheet", group: "Billing" },
  { key: "billingSimulator", label: "Billing Simulator", path: "/admin/billing-simulator", group: "Billing", adminOnly: true },

  // ── Finance ───────────────────────────────────────────────────────────
  { key: "ledger", label: "Ledger", path: "/admin/ledger", group: "Finance" },
  { key: "payments", label: "Payments", path: "/admin/payments", group: "Finance" },
  { key: "receipts", label: "Receipts", path: "/admin/receipts", group: "Finance" },
  { key: "latePayment", label: "Late Payments", path: "/admin/late-payment", group: "Finance" },
  { key: "expenditure", label: "Expenditure", path: "/admin/expenditure", group: "Finance" },
  { key: "paymentsReceived", label: "Payments Received", path: "/admin/payments-received", group: "Finance" },

  // ── Financial Statements ─────────────────────────────────────────────
  { key: "openingBalances", label: "Opening Balances", path: "/admin/opening-balances", group: "Financial Statements" },
  { key: "generateStatements", label: "Generate Statements", path: "/admin/generate-statements", group: "Financial Statements" },
  { key: "incomeExpenditure", label: "Income & Expenditure", path: "/admin/income-expenditure", group: "Financial Statements" },
  { key: "assetsLiabilities", label: "Assets & Liabilities", path: "/admin/assets-liabilities", group: "Financial Statements" },
  { key: "otherStatements", label: "Trial Balance & Validation", path: "/admin/other-statements", group: "Financial Statements" },

  // ── Communication ─────────────────────────────────────────────────────
  { key: "notices", label: "Notices", path: "/admin/notices", group: "Communication" },
  { key: "complaints", label: "Complaints", path: "/admin/complaints", group: "Communication" },

  // ── Security ──────────────────────────────────────────────────────────
  { key: "visitors", label: "Visitors", path: "/admin/visitors", group: "Security" },
  { key: "visitorsActive", label: "Active Visitors", path: "/admin/visitors/active", group: "Security" },
  { key: "visitorsLog", label: "Visitor Log", path: "/admin/visitors/log", group: "Security" },
  { key: "visitorsAudit", label: "Offline Audit", path: "/admin/visitors/audit", group: "Security" },
  { key: "securityGuards", label: "Security Guards", path: "/admin/security-guards", group: "Security" },
  { key: "blacklist", label: "Watchlist", path: "/admin/blacklist", group: "Security" },

  // ── Commercial (feature-flagged module; single page permission) ──────
  { key: "commercial", label: "Commercial", path: "/admin/commercial", group: "Commercial" },

  // ── Amenities (single page permission for the whole module) ──────────
  { key: "amenities", label: "Amenities", path: "/admin/amenities", group: "Amenities" },

  // ── Administration ────────────────────────────────────────────────────
  { key: "auditReport", label: "Audit Report", path: "/admin/audit", group: "Administration" },
  { key: "roleManager", label: "Roles & Access", path: "/admin/rbac/roles", group: "Administration", adminOnly: true },
  { key: "systemTests", label: "System Test Tools", path: "/admin/accounting-lab", group: "Administration", adminOnly: true },
];

export const PAGE_KEYS = new Set(PAGE_CATALOG.map((p) => p.key));

export function pageByKey(key) {
  return PAGE_CATALOG.find((p) => p.key === key) || null;
}

/** myAccess (/my-access) is granted to every authenticated user implicitly — not part of pageAccess. */
export const IMPLICIT_PAGES = new Set(["myAccess"]);

export default PAGE_CATALOG;

/**
 * ============================================================================
 * AapliSociety RBAC — Route → Permission Map  (Phase 2)
 * ============================================================================
 * SINGLE SOURCE OF TRUTH for "which permission guards which route" (Rules 5-7).
 * Consumed by:
 *   - scripts/rbac/check-route-guards.js  (CI: every route file must appear here)
 *   - the migration effort (each route's authorize(...) uses the id below)
 *   - the verification report
 *
 * Value grammar per route (keyed by repo-relative route file path):
 *   { GET|POST|PUT|PATCH|DELETE: "<permission id>" }   concrete leaf permission
 *   { ALL: "<permission id>" }                          same perm for all methods
 *   { category: "PUBLIC" }        no authentication (login, refresh, onboarding)
 *   { category: "AUTH_ONLY" }     any authenticated user; own-data only
 *   { category: "MEMBER_SELF" }   member hat; ownership enforced at data layer
 *   { category: "SUPERADMIN" }    platform admin DB; OUT OF RBAC SCOPE
 *   { category: "CRON" }          scheduled job; protect via CRON_SECRET, not RBAC
 *   { category: "REVIEW", warn }  inconsistency found — DO NOT auto-assign (Rule 9)
 *
 * Rule 9 compliance: where a route needs an action that has no catalog entry
 * yet, it is tagged REVIEW with a `warn` message. We surface the warning
 * instead of silently inventing/implying a permission.
 * ============================================================================
 */

export const ROUTE_PERMISSIONS = {
  // ── AUTH / ONBOARDING (public or auth-only) ───────────────────────────────
  "app/api/auth/login/route.js": { category: "PUBLIC" },
  "app/api/auth/refresh/route.js": { category: "PUBLIC" },
  "app/api/auth/resolve-role/route.js": { category: "PUBLIC" },
  "app/api/auth/signup/route.js": { category: "PUBLIC" },
  "app/api/auth/token/route.js": { category: "AUTH_ONLY" },
  "app/api/auth/logout/route.js": { category: "AUTH_ONLY" },
  "app/api/auth/me/route.js": { category: "AUTH_ONLY" },
  "app/api/auth/switch-profile/route.js": { category: "AUTH_ONLY" },
  "app/api/auth/switch-context/route.js": { category: "AUTH_ONLY" }, // NEW (Phase 2)
  "app/api/context/route.js": { category: "AUTH_ONLY" },
  "app/api/onboarding/set-credentials/route.js": { category: "PUBLIC" },
  "app/api/onboarding/verify/route.js": { category: "PUBLIC" },
  "app/api/push/subscribe/route.js": { category: "AUTH_ONLY" },

  // ── NEW RBAC ADMIN ENDPOINTS (Phase 2) ─────────────────────────────────
  "app/api/rbac/my-access/route.js": { category: "AUTH_ONLY" },
  "app/api/rbac/permissions/route.js": { GET: "rbac.role.view" },
  "app/api/rbac/roles/route.js": {
    GET: "rbac.role.view",
    POST: "rbac.role.create",
  },
  "app/api/rbac/roles/[id]/route.js": {
    GET: "rbac.role.view",
    PATCH: "rbac.role.update",
    DELETE: "rbac.role.delete",
  },
  "app/api/rbac/roles/[id]/impact/route.js": { GET: "rbac.role.delete" },
  "app/api/rbac/roles/[id]/restore-defaults/route.js": {
    POST: "rbac.role.restoreDefaults",
  },
  "app/api/rbac/assignments/route.js": {
    GET: "rbac.assignment.view",
    POST: "rbac.assignment.assign",
  },
  "app/api/rbac/assignments/[id]/route.js": {
    DELETE: "rbac.assignment.unassign",
  },
  // suspend|reactivate are branched by body.action and authorized SEPARATELY
  // Collection route: GET lists society login users, POST creates a login user
  // and assigns them a role in one step (Phase 3 access-management surface).
  "app/api/rbac/users/route.js": {
    GET: "rbac.user.view",
    POST: "rbac.user.create",
  },
  // users/[id] PATCH authorizes the action-specific permission
  // inside the handler (rbac.user.suspend vs rbac.user.reactivate) — never merged.
  "app/api/rbac/users/[id]/route.js": {
    PATCH: "rbac.user.suspend",
    PATCH_reactivate: "rbac.user.reactivate",
  },

  // ── PLATFORM / SUPERADMIN (out of RBAC scope) ────────────────────────────
  "app/api/admin/auth/login/route.js": { category: "SUPERADMIN" },
  "app/api/admin/societies/route.js": { category: "SUPERADMIN" },
  "app/api/admin/societies/[id]/route.js": { category: "SUPERADMIN" },
  "app/api/admin/societies/create/route.js": { category: "SUPERADMIN" },
  "app/api/admin/societies/validate-excel/route.js": { category: "SUPERADMIN" },
  "app/api/admin/stats/route.js": { category: "SUPERADMIN" },
  // GROUNDED against society.md: these three /admin/* routes are SOCIETY-scoped
  // (data-browser POST exports-to-admin-DB then deletes; exports = data export;
  // logs = society audit). Mapped to society/audit permissions, not SUPERADMIN.
  "app/api/admin/data-browser/route.js": {
    GET: "society.data.view",
    POST: "society.data.delete",
  },
  "app/api/admin/exports/route.js": { GET: "society.data.export" },
  "app/api/admin/logs/route.js": { GET: "audit.log.read" },
  "app/api/society/create/route.js": { category: "SUPERADMIN" },
  // GROUNDED: user directory used by access-management surfaces → rbac.user.view.
  "app/api/users/list/route.js": { GET: "rbac.user.view" },
  "app/api/superadmin/audit-reports/route.js": { category: "SUPERADMIN" },
  "app/api/superadmin/bill-history-import/route.js": { category: "SUPERADMIN" },
  "app/api/superadmin/bill-history-template/route.js": {
    category: "SUPERADMIN",
  },
  "app/api/superadmin/delete-society/route.js": { category: "SUPERADMIN" },
  "app/api/superadmin/fix-history-bills/route.js": { category: "SUPERADMIN" },
  "app/api/superadmin/member-credentials/route.js": { category: "SUPERADMIN" },
  "app/api/superadmin/reset-admin-password/route.js": {
    category: "SUPERADMIN",
  },
  "app/api/superadmin/reset-member-passwords/route.js": {
    category: "SUPERADMIN",
  },
  "app/api/superadmin/society-detail/route.js": { category: "SUPERADMIN" },

  // ── SOCIETY-STAFF ADMIN ROUTES (RBAC-scoped) ─────────────────────────────
  "app/api/admin/audit-report/route.js": {
    GET: "audit.report.view",
    POST: "audit.report.create",
  },
  "app/api/admin/dashboard-stats/route.js": { GET: "dashboard.stats.view" },
  "app/api/admin/blacklist/route.js": {
    GET: "visitor.blacklist.view",
    POST: "visitor.blacklist.add",
    DELETE: "visitor.blacklist.remove",
  },
  "app/api/admin/bulk-import/route.js": { POST: "member.member.import" },
  "app/api/admin/bulk-import/template/route.js": {
    GET: "member.importMembers.view",
  },
  "app/api/admin/profile-edit-requests/route.js": {
    GET: "member.profileEditRequest.view",
  },
  "app/api/admin/profile-edit-requests/[id]/approve/route.js": {
    POST: "member.profileEditRequest.approve",
  },
  "app/api/admin/profile-edit-requests/[id]/reject/route.js": {
    POST: "member.profileEditRequest.reject",
  },
  "app/api/admin/security-guards/route.js": {
    GET: "security.guard.view",
    POST: "security.guard.create",
  },
  "app/api/admin/security-guards/[id]/route.js": {
    GET: "security.guard.view",
    PUT: "security.guard.update",
    PATCH: "security.guard.update",
    DELETE: "security.guard.delete",
  },
  "app/api/admin/tenant-requests/route.js": {
    GET: "member.tenantRequest.view",
  },
  "app/api/admin/tenant-requests/[id]/approve/route.js": {
    POST: "member.tenantRequest.approve",
  },
  "app/api/admin/tenant-requests/[id]/reject/route.js": {
    POST: "member.tenantRequest.reject",
  },
  "app/api/admin/tenant-requests/[id]/confirm-move-out/route.js": {
    POST: "member.tenantRequest.confirmMoveOut",
  },
  "app/api/admin/tenant-requests/[id]/documents/[field]/route.js": {
    GET: "member.tenantRequest.view",
  },
  "app/api/admin/visitors/route.js": { GET: "visitor.visitor.view" },
  "app/api/admin/visitors/analytics/route.js": { GET: "visitor.visitor.view" },
  "app/api/admin/visitors/audit/route.js": { GET: "visitor.audit.view" },

  // ── BILL TEMPLATE ────────────────────────────────────────────────
  "app/api/bill-template/route.js": { GET: "billing.template.view" },
  "app/api/bill-template/get/route.js": { GET: "billing.template.view" },
  "app/api/bill-template/get-full/route.js": { GET: "billing.template.view" },
  "app/api/bill-template/save/route.js": { POST: "billing.template.update" },
  "app/api/bill-template/save-full/route.js": {
    POST: "billing.template.update",
  },
  "app/api/bill-template/upload-file/route.js": {
    POST: "billing.template.upload",
  },
  "app/api/bill-template/upload-image/route.js": {
    POST: "billing.template.upload",
  },
  "app/api/bill-template/upload-pdf-smart/route.js": {
    POST: "billing.template.upload",
  },

  // ── BILLING CONFIG + HEADS ────────────────────────────────────────
  "app/api/billing-config/route.js": {
    GET: "billing.config.view",
    POST: "billing.config.update",
    PUT: "billing.config.update",
  },
  "app/api/billing-heads/list/route.js": { GET: "billing.head.view" },
  "app/api/billing-heads/create/route.js": { POST: "billing.head.create" },
  "app/api/billing-heads/[id]/update/route.js": {
    POST: "billing.head.update",
    PUT: "billing.head.update",
  },
  "app/api/billing-heads/[id]/delete/route.js": {
    POST: "billing.head.delete",
    DELETE: "billing.head.delete",
  },
  "app/api/billing-heads/setup-defaults/route.js": {
    POST: "billing.head.create",
  },
  "app/api/billing-heads/setup-defaults/create/route.js": {
    POST: "billing.head.create",
  },

  // ── BILLING SIMULATOR (society admin test tooling) ─────────────────────────
  "app/api/billing-simulator/route.js": { POST: "billing.dashboard.view" },
  "app/api/billing-simulator/members/route.js": { GET: "billing.bill.view" },
  "app/api/billing-simulator/generate-real/route.js": {
    POST: "billing.bill.generate",
  },
  "app/api/billing-simulator/pay-real/route.js": {
    POST: "finance.payment.record",
  },

  // ── BILLING ───────────────────────────────────────────────────
  "app/api/billing/balance-sheet/route.js": {
    GET: "billing.balanceSheet.view",
  },
  "app/api/billing/check-payments-uploaded/route.js": {
    GET: "billing.bill.view",
  },
  "app/api/billing/excel-template/route.js": { GET: "billing.bill.view" },
  "app/api/billing/export/route.js": { GET: "billing.bill.export" },
  "app/api/billing/generate/route.js": { POST: "billing.bill.generate" },
  "app/api/billing/generate-from-excel/route.js": {
    POST: "billing.bill.generate",
  },
  "app/api/billing/generate-pdf/route.js": {
    POST: "billing.bill.download",
    GET: "billing.bill.download",
  },
  "app/api/billing/generated/route.js": { GET: "billing.bill.view" },
  "app/api/billing/list/route.js": { GET: "billing.bill.view" },
  "app/api/billing/payment-template/route.js": { GET: "finance.payment.view" },
  "app/api/billing/preview/route.js": {
    POST: "billing.bill.view",
    GET: "billing.bill.view",
  },
  "app/api/billing/template/route.js": { GET: "billing.template.view" },
  "app/api/billing/update/route.js": {
    POST: "billing.bill.update",
    PUT: "billing.bill.update",
  },
  "app/api/billing/upload-payments/route.js": {
    POST: "finance.payment.upload",
  },
  "app/api/billing/upload-template/route.js": {
    POST: "billing.template.upload",
  },
  "app/api/billing/validate-excel/route.js": { POST: "billing.bill.generate" },
  "app/api/billing/year-range/route.js": { GET: "billing.bill.view" },

  // ── BILLS ─────────────────────────────────────────────────────
  "app/api/bills/delete/route.js": { POST: "billing.bill.delete" },
  "app/api/bills/download/route.js": {
    GET: "billing.bill.download",
    POST: "billing.bill.download",
  },
  "app/api/bills/generate-final/route.js": { POST: "billing.bill.generate" },
  "app/api/bills/get-previous-balances/route.js": {
    GET: "billing.bill.view",
    POST: "billing.bill.view",
  },
  "app/api/bills/import/route.js": { POST: "billing.bill.import" },
  "app/api/bills/latest-period/route.js": { GET: "billing.bill.view" },
  "app/api/bills/push-scheduled/route.js": {
    category: "CRON",
    note: "scheduled bill push; guard with CRON_SECRET",
  },

  // ── COMPLAINTS ──────────────────────────────────────────────────
  "app/api/complaints/route.js": {
    // GET = approved complaints visible to any authenticated member (self view).
    // POST = a MEMBER files a complaint → complaint.complaint.create (now in catalog).
    category: "MEMBER_SELF",
    GET: "complaint.complaint.view",
    POST: "complaint.complaint.create",
  },
  "app/api/complaints/my/route.js": {
    category: "MEMBER_SELF",
    GET: "complaint.complaint.view",
  },
  "app/api/complaints/[id]/route.js": { GET: "complaint.complaint.view" },
  "app/api/complaints/[id]/reply/route.js": {
    POST: "complaint.complaint.reply",
  },
  "app/api/complaints/admin/route.js": { GET: "complaint.complaint.view" },
  "app/api/complaints/admin/[id]/approve/route.js": {
    POST: "complaint.complaint.approve",
  },
  "app/api/complaints/admin/[id]/reject/route.js": {
    POST: "complaint.complaint.reject",
  },
  "app/api/complaints/admin/auto-close/route.js": {
    category: "CRON",
    note: "auto-close job; guard with CRON_SECRET or complaint.complaint.close if admin-triggered",
  },

  // ── DATABASE MANAGER (society) ─────────────────────────────────────
  "app/api/db-manager/[entity]/route.js": { GET: "society.data.view" },
  "app/api/db-manager/[entity]/export/route.js": {
    GET: "society.data.export",
    POST: "society.data.export",
  },
  "app/api/db-manager/[entity]/import/route.js": {
    POST: "society.data.import",
  },
  "app/api/db-manager/[entity]/reset/route.js": { DELETE: "society.data.reset" },
  "app/api/db-manager/[entity]/delete/route.js": {
    POST: "society.data.delete",
    DELETE: "society.data.delete",
  },

  // ── LEDGER ───────────────────────────────────────────────────
  "app/api/ledger/route.js": { GET: "finance.ledger.view" },
  "app/api/ledger/fetch/route.js": {
    GET: "finance.ledger.view",
    POST: "finance.ledger.view",
  },
  "app/api/ledger/export/route.js": {
    GET: "finance.ledger.export",
    POST: "finance.ledger.export",
  },
  "app/api/ledger/calculate-interest/route.js": {
    POST: "finance.ledger.calculateInterest",
  },
  "app/api/ledger/transaction/[id]/route.js": {
    GET: "finance.ledger.view",
    POST: "finance.ledger.transaction",
    PUT: "finance.ledger.transaction",
    PATCH: "finance.ledger.transaction",
    DELETE: "finance.ledger.transaction",
  },

  // ── MEMBER SELF-SERVICE (member hat; ownership enforced) ────────────────────
  "app/api/member/bills/route.js": {
    category: "MEMBER_SELF",
    GET: "billing.bill.view",
  },
  "app/api/member/ledger/route.js": {
    category: "MEMBER_SELF",
    GET: "finance.ledger.view",
  },
  "app/api/member/pay/route.js": {
    category: "MEMBER_SELF",
    POST: "finance.payment.record",
  },
  "app/api/member/receipts/route.js": {
    category: "MEMBER_SELF",
    GET: "finance.receipt.view",
  },
  "app/api/member/receipts/[id]/download/route.js": {
    category: "MEMBER_SELF",
    GET: "finance.receipt.download",
  },
  "app/api/member/profile/route.js": {
    category: "MEMBER_SELF",
    GET: "member.profile.viewSelf",
    PUT: "member.profile.updateSelf",
  },

  // ── MEMBERS (staff management) ──────────────────────────────────────
  "app/api/members/list/route.js": { GET: "member.member.view" },
  "app/api/members/update/route.js": {
    POST: "member.member.update",
    PUT: "member.member.update",
  },
  "app/api/members/quick-patch/route.js": {
    POST: "member.member.update",
    PATCH: "member.member.update",
  },
  "app/api/members/import/route.js": { POST: "member.member.import" },
  "app/api/members/preview-import/route.js": { POST: "member.member.import" },
  "app/api/members/confirm-import/route.js": { POST: "member.member.import" },
  "app/api/members/fix-duplicates/route.js": { POST: "member.member.update" },
  "app/api/members/download-credentials/route.js": {
    GET: "member.member.downloadCredentials",
    POST: "member.member.downloadCredentials",
  },
  "app/api/members/template/route.js": { GET: "member.importMembers.view" },

  // ── NOTICES ──────────────────────────────────────────────────
  "app/api/notices/route.js": {
    GET: "notice.notice.view",
    POST: "notice.notice.create",
  },
  "app/api/notices/[id]/route.js": {
    GET: "notice.notice.view",
    PUT: "notice.notice.update",
    PATCH: "notice.notice.update",
    DELETE: "notice.notice.delete",
  },
  "app/api/notices/[id]/acknowledge/route.js": {
    category: "MEMBER_SELF",
    POST: "notice.notice.view",
  },
  "app/api/notices/[id]/viewed/route.js": {
    category: "MEMBER_SELF",
    POST: "notice.notice.view",
  },

  // ── NOTIFICATIONS (own inbox) ──────────────────────────────────────
  "app/api/notifications/route.js": { category: "AUTH_ONLY" },
  "app/api/notifications/[id]/route.js": { category: "AUTH_ONLY" },
  "app/api/notifications/mark-read/route.js": { category: "AUTH_ONLY" },
  "app/api/notifications/mark-all-read/route.js": { category: "AUTH_ONLY" },

  // ── PAYMENTS / RECEIPTS ──────────────────────────────────────────
  "app/api/payments/list/route.js": { GET: "finance.payment.view" },
  "app/api/payments/outstanding/route.js": { GET: "finance.payment.view" },
  "app/api/payments/late-list/route.js": { GET: "finance.payment.view" },
  "app/api/payments/record/route.js": { POST: "finance.payment.record" },
  "app/api/receipts/route.js": { GET: "finance.receipt.view" },

  // ── SECURITY GATE ─────────────────────────────────────────────
  "app/api/security/auth/login/route.js": { category: "PUBLIC" },
  "app/api/security/flats/search/route.js": { GET: "visitor.visitor.view" },
  "app/api/security/stats/route.js": { GET: "visitor.gate.view" },
  "app/api/security/visitors/route.js": { GET: "visitor.visitor.view" },

  // ── SOCIETY CONFIG ───────────────────────────────────────────
  "app/api/society/config/route.js": {
    GET: "society.config.view",
    POST: "society.config.update",
    PUT: "society.config.update",
  },
  "app/api/society/update/route.js": {
    POST: "society.config.update",
    PUT: "society.config.update",
  },
  "app/api/society/upload-template/route.js": {
    POST: "billing.template.upload",
  },
  // GROUNDED against society.md: CRUD on society financial-year entries
  // (GET ?fy=, POST create, DELETE ?id=) → new finance.societyEntry.* perms.
  "app/api/society-entries/route.js": {
    GET: "finance.societyEntry.view",
    POST: "finance.societyEntry.create",
    DELETE: "finance.societyEntry.delete",
  },

  // ── VISITOR ─────────────────────────────────────────────────
  "app/api/visitor/list/route.js": { GET: "visitor.visitor.view" },
  "app/api/visitor/log/route.js": {
    GET: "visitor.log.view",
    POST: "visitor.visitor.enter",
  },
  "app/api/visitor/enter/route.js": { POST: "visitor.visitor.enter" },
  "app/api/visitor/confirm-entry/route.js": { POST: "visitor.visitor.enter" },
  "app/api/visitor/exit/route.js": { POST: "visitor.visitor.exit" },
  "app/api/visitor/approve/route.js": { POST: "visitor.visitor.approve" },
  "app/api/visitor/extend/route.js": { POST: "visitor.visitor.extend" },
  "app/api/visitor/guard-admit/route.js": {
    PATCH: "visitor.visitor.guardAdmit",
  },
  "app/api/visitor/offline-entry/route.js": {
    POST: "visitor.visitor.offlineEntry",
  },
  "app/api/visitor/sos/route.js": { POST: "visitor.visitor.sos" },
  "app/api/visitor/remind/route.js": { PATCH: "visitor.visitor.view" },
  "app/api/visitor/upload-photo/route.js": { POST: "visitor.visitor.enter" },
  "app/api/visitor/pass/route.js": {
    GET: "visitor.pass.view",
    POST: "visitor.pass.create",
  },
  "app/api/visitor/pass/[id]/route.js": {
    GET: "visitor.pass.view",
    DELETE: "visitor.pass.delete",
  },
  "app/api/visitor/pass/verify/route.js": { POST: "visitor.pass.verify" },
  "app/api/visitor/cron/escalate/route.js": {
    category: "CRON",
    note: "escalation job; guard with CRON_SECRET",
  },
};

/** Categories that are intentionally NOT guarded by a leaf permission. */
export const NON_PERMISSION_CATEGORIES = new Set([
  "PUBLIC",
  "AUTH_ONLY",
  "MEMBER_SELF",
  "SUPERADMIN",
  "CRON",
  "REVIEW",
]);

export default ROUTE_PERMISSIONS;

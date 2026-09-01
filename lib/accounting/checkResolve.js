/**
 * Shared map: a CHECK_REGISTRY rule name (lib/accounting/validation/checks.js)
 * -> plain-language label + where to fix it. Single source so the Year-End
 * Close checklist and the QuickBar action inbox never drift apart — both
 * read the same 7 real checks via /api/accounting/validation/run.
 */
export const CHECK_RESOLVE = {
  trialBalanceBalanced: { label: "Trial Balance balanced", fix: "Review Trial Balance", href: "/admin/accounting/statements?tab=trial-balance" },
  accountsMissingScheduleCode: { label: "Every account head has a Schedule", fix: "Assign headings", href: "/admin/accounting/books?tab=schedules" },
  defaultAccountMappingsConfigured: { label: "Default account mappings configured", fix: "Fiscal configuration", href: "/admin/accounting?drawer=fiscal-config" },
  draftVouchersPending: { label: "No vouchers left in Draft", fix: "Review vouchers", href: "/admin/accounting/books?tab=entries" },
  depreciationPosted: { label: "Depreciation posted for the year", fix: "Post depreciation", href: "/admin/accounting/registers?tab=assets" },
  bankStatementLinesUnmatched: { label: "Bank statements fully reconciled", fix: "Review matches", href: "/admin/accounting/registers?tab=bank-accounts" },
  liabilitiesOverdue: { label: "No overdue liabilities", fix: "Review liabilities", href: "/admin/accounting/registers?tab=liabilities" },
};

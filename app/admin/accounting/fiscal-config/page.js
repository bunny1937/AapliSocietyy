/**
 * /admin/accounting/fiscal-config — folded into the Hub as a drawer, same as
 * financial-years/posting-rules/validation-rules/schedules (design doc §12
 * Phase 4). Redirect, not a 404 — old links keep working. See
 * docs/accounting-module-audit-and-consolidation-plan.md §3 item 3.
 */
import { redirect } from "next/navigation";

export default function FiscalConfigRedirect() {
  redirect("/admin/accounting?drawer=fiscal-config");
}

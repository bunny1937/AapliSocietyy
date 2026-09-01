/**
 * /admin/accounting/financial-years — folded into the Hub as a drawer
 * (design doc §12 Phase 4). Redirect, not a 404 — old links keep working.
 */
import { redirect } from "next/navigation";

export default function FinancialYearsRedirect() {
  redirect("/admin/accounting?drawer=financial-years");
}

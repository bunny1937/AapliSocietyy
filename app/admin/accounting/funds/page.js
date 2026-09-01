/**
 * /admin/accounting/funds — folded into /admin/accounting/registers (design
 * doc: docs/accounting-module-audit-and-consolidation-plan.md §4). The route
 * stays as a redirect so an old bookmark or a stray Link elsewhere in the
 * app still lands somewhere real, on the right tab.
 */
import { redirect } from "next/navigation";

export default function FundsRedirect() {
  redirect("/admin/accounting/registers?tab=funds");
}

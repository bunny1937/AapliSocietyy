/**
 * /admin/accounting/bank-accounts — folded into /admin/accounting/cash-flow
 * (the accounting UI/UX revamp: "Cash Flow Setup" is its own page, separate
 * from "Assets & Liabilities"). The route stays as a redirect so an old
 * bookmark or a stray Link elsewhere in the app still lands somewhere real.
 */
import { redirect } from "next/navigation";

export default function BankAccountsRedirect() {
  redirect("/admin/accounting/cash-flow");
}

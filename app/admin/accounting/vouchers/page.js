/**
 * /admin/accounting/vouchers — folded into /admin/accounting/books (design
 * doc §12 Phase 4). The route stays as a redirect so an old bookmark or a
 * stray Link elsewhere in the app still lands somewhere real, on the right
 * tab, instead of the loud 404 app/admin/[...catchAll]/page.js would
 * otherwise show it.
 */
import { redirect } from "next/navigation";

export default function VouchersRedirect() {
  redirect("/admin/accounting/books?tab=entries");
}

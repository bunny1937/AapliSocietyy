/**
 * /admin/accounting/assets — folded into /admin/accounting/registers (design
 * doc: docs/accounting-module-audit-and-consolidation-plan.md §4). The route
 * stays as a redirect so an old bookmark or a stray Link elsewhere in the
 * app still lands somewhere real, on the right tab, instead of the loud 404
 * app/admin/[...catchAll]/page.js would otherwise show it.
 */
import { redirect } from "next/navigation";

export default function AssetsRedirect() {
  redirect("/admin/accounting/registers?tab=assets");
}

/**
 * /admin/other-statements — folded into /admin/accounting/statements
 * (design doc §12 Phase 5). Redirect, not a 404 — old links keep working.
 */
import { redirect } from "next/navigation";

export default function OtherStatementsRedirect() {
  redirect("/admin/accounting/statements?tab=trial-balance");
}

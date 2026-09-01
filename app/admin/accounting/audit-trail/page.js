/**
 * /admin/accounting/audit-trail — folded into /admin/accounting/books
 * (design doc §12 Phase 4). Redirect, not a 404 — old links keep working.
 */
import { redirect } from "next/navigation";

export default function AuditTrailRedirect() {
  redirect("/admin/accounting/books?tab=corrections");
}

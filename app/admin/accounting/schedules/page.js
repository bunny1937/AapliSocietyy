/**
 * /admin/accounting/schedules — now /admin/accounting/format (page 5 of the
 * 6-page accounting environment, "Balance Sheet Format"). Redirect, not a
 * 404 — old links keep working.
 */
import { redirect } from "next/navigation";

export default function SchedulesRedirect() {
  redirect("/admin/accounting/format");
}

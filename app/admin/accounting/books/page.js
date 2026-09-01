/**
 * /admin/accounting/books — Entries + The books + Corrections, one page,
 * three tabs. Design doc §12 Phase 4: "Merge vouchers + journal-entries +
 * audit-trail -> /admin/accounting/books."
 *
 * PAGE GUARD: any of the three underlying view permissions gets you in —
 * see lib/rbac/page-guard.js's requirePagePermissionAny. Each tab still
 * mounts its own PageClient, which does its own data-fetching against its
 * own permission-gated API routes, so a user with only one of the three
 * perms reaches the page and sees only the tab that works for them.
 */
import { requirePagePermissionAny } from "@/lib/rbac/page-guard";
import PageClient from "./PageClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePagePermissionAny([
    "accounting.vouchers.view",
    "accounting.journalEntries.view",
    "accounting.auditTrail.view",
  ]);
  return <PageClient />;
}

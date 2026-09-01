/**
 * /admin/accounting/auditor — the Auditor workspace. Design doc §8, §12
 * Phase 5: four tabs (Position, Statements, Corrections, Queries), reachable
 * by the read-only "Auditor" system role plus the two write actions the doc
 * carves out for it (raise/resolve a query).
 *
 * PAGE GUARD: server-side requirePagePermission() before any UI renders.
 */
import { requirePagePermission } from "@/lib/rbac/page-guard";
import PageClient from "./PageClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePagePermission("auditor.workspace.view");
  return <PageClient />;
}

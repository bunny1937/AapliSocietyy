/**
 * /admin/accounting/chart-of-accounts — the account heads, as a real page.
 *
 * Until now these existed only inside the accounting-lab test harness, which
 * is why the checklist had nowhere to send anyone.
 *
 * PAGE GUARD: server-side requirePagePermission() before any UI renders.
 * See docs/accounting-guided-ux/00-plan.md Phase 4.
 */

import { requirePagePermission } from "@/lib/rbac/page-guard";
import PageClient from "./PageClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePagePermission("accounting.chartOfAccounts.view");
  return <PageClient />;
}

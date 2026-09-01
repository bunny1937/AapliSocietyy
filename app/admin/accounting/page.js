/**
 * /admin/accounting — the Accounting overview.
 *
 * The home of the group that did not exist. Everything else in Accounting
 * links back here, so this is the one page that must always answer "where am I
 * and what do I do next".
 *
 * PAGE GUARD: server-side requirePagePermission() before any UI renders.
 * See docs/accounting-guided-ux/00-plan.md Phase 2.
 */

import { requirePagePermission } from "@/lib/rbac/page-guard";
import PageClient from "./PageClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePagePermission("accounting.overview.view");
  return <PageClient />;
}

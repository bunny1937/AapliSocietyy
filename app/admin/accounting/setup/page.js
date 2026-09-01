/**
 * /admin/accounting/setup — the guided setup.
 *
 * PAGE GUARD: server-side requirePagePermission() before any UI renders.
 * See docs/accounting-guided-ux/00-plan.md Phase 3.
 */

import { requirePagePermission } from "@/lib/rbac/page-guard";
import PageClient from "./PageClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePagePermission("accounting.setup.view");
  return <PageClient />;
}

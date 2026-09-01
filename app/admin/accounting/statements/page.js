/**
 * /admin/accounting/statements — Generate Statements + Income & Expenditure +
 * Assets & Liabilities + Trial Balance & Validation, one page, four tabs.
 * Design doc §12 Phase 5: "/admin/accounting/statements consuming the four
 * existing statement APIs + trial balance + exports."
 */
import { requirePagePermissionAny } from "@/lib/rbac/page-guard";
import PageClient from "./PageClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePagePermissionAny([
    "statements.generateStatements.view",
    "statements.incomeExpenditure.view",
    "statements.assetsLiabilities.view",
    "statements.otherStatements.view",
  ]);
  return <PageClient />;
}

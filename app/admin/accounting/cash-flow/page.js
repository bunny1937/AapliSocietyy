/**
 * Page 4 of the 6-page accounting environment: Cash Flow Setup.
 * Bank accounts + reconciliation, carried out of the Registers page so
 * "Assets & Liabilities" and "Cash Flow Setup" are the two separate pages
 * the revamp spec calls for.
 */
import { requirePagePermission } from "@/lib/rbac/page-guard";
import PageClient from "./PageClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePagePermission("accounting.bankAccounts.view");
  return <PageClient />;
}

/**
 * Page 5 of the 6-page accounting environment: Balance Sheet Format.
 * Which account head prints under which Schedule, in what order, and
 * whether it shows at all — moved here from the old "Statement Layout"
 * drawer per the accounting UI/UX revamp.
 */
import { requirePagePermission } from "@/lib/rbac/page-guard";
import PageClient from "./PageClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePagePermission("accounting.schedules.view");
  return <PageClient />;
}

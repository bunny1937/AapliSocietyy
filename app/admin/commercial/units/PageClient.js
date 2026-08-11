// app/admin/commercial/units/page.js
//
// RETIRED 2026-08-08.
//
// This listed every flat so one could be re-labelled as a shop. That
// re-labelling is exactly what destroyed flat A-103, and it no longer exists:
// a shop is its own record, created on the Shops screen, and no flat is ever
// touched. Repairing a wrongly-labelled flat is done on the Members screen.
//
// This file is left as a redirect so that an old bookmark, or a link from
// somewhere in the app I have not found, still lands somewhere sensible
// instead of on a 404. You can safely delete this folder once you are sure
// nothing links here.

import { redirect } from "next/navigation";

export default function RetiredCommercialUnitsPage() {
  redirect("/admin/commercial/shops");
}

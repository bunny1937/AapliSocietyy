// app/admin/commercial/businesses/page.js
//
// RETIRED 2026-08-08.
//
// This was a third list of the same shops, and it still asked whether a
// unit was residential or commercial -- a question that stopped making sense
// once shops became their own records. The per-business editor it linked to
// now lives at /admin/commercial/shops/[id].
//
// This file is left as a redirect so that an old bookmark, or a link from
// somewhere in the app I have not found, still lands somewhere sensible
// instead of on a 404. You can safely delete this folder once you are sure
// nothing links here.

import { redirect } from "next/navigation";

export default function RetiredCommercialBusinessesPage() {
  redirect("/admin/commercial/shops");
}

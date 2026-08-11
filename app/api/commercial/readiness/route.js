// app/api/commercial/readiness/route.js
//
// NEW ROUTE.
//
// "Am I ready to bill my shops?" answered in one call, in plain English.
//
// Before this, the only feedback loop was: preview a bill -> read the numbers ->
// guess what went wrong. Every issue returned here carries a title, a reason,
// a concrete fix and the page to fix it on.
import { adminCommercialRoute } from "@/lib/commercial/adminRoute";
import { getCommercialReadiness } from "@/lib/commercial/commercialReadiness";

export const dynamic = "force-dynamic";

export const GET = adminCommercialRoute(
  "commercial.readiness",
  async ({ societyId, req, flags }) => {
    const periodId = new URL(req.url).searchParams.get("periodId") || null;
    const valid = periodId && /^\d{4}-(0[1-9]|1[0-2])$/.test(periodId) ? periodId : null;
    return getCommercialReadiness({ societyId, periodId: valid, flags });
  },
  // Deliberately gated on the module flag, not the billing flag: "commercial
  // billing is switched off" is itself one of the answers this endpoint gives.
  // Also read from Generate Bills (readiness check before running a bill
  // batch), not just the Commercial admin page.
  { requireFlag: "enabled", extraViewIds: ["billing.dashboard.view"] },
);

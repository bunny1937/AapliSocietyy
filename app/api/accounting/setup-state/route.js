/**
 * GET /api/accounting/setup-state
 * ----------------------------------------------------------------------------
 * The shared answer to "how far is this society set up, and what is next".
 * Read by the Accounting overview, and by the prerequisite banner on every
 * accounting page — see docs/accounting-guided-ux/00-plan.md §3.
 *
 * Required permission : any accounting/statement page-view permission
 * Tenant validation   : societyId from the verified token, never the query
 * Audit behaviour     : none (read-only)
 * Failure behaviour   : 401/403 authorize; 500 otherwise
 *
 * ## Why the permission list is wide
 *
 * This is the thing that tells someone they are in the wrong place and where
 * to go instead. Gating it more tightly than the pages that render it would
 * mean the person most likely to be lost — an admin with partial access,
 * mid-setup — is the one who gets a blank banner. It exposes no figures: step
 * labels, counts, and what to do next.
 *
 * `optional=1` returns `{ available: false }` instead of a 403, so a page can
 * render its banner or omit it without treating a permission gap as an error.
 */

import { NextResponse } from "next/server";
import { authorizeAny } from "@/lib/rbac/authorize";
import { requireAccounting } from "@/lib/authz";
import { getSetupState } from "@/lib/services/AccountingSetupStateService";

export const dynamic = "force-dynamic";

const VIEWERS = [
  "accounting.overview.view",
  "accounting.financialYears.view",
  "statements.openingBalances.view",
  "statements.generateStatements.view",
  "statements.incomeExpenditure.view",
  "statements.assetsLiabilities.view",
  "statements.otherStatements.view",
  "finance.ledger.view",
  "society.systemTests.view",
];

export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;

  const optional = new URL(request.url).searchParams.get("optional") === "1";
  const gate = await authorizeAny(request, VIEWERS);
  if (!gate.ok) {
    return optional
      ? NextResponse.json({ available: false })
      : gate.response;
  }

  try {
    const state = await getSetupState(gate.context.societyId);
    return NextResponse.json({ available: true, ...state });
  } catch (error) {
    console.error("[accounting] setup-state failed:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

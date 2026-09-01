import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { authorizeAny } from "@/lib/rbac/authorize";
import { getTemplateDiff } from "@/lib/accounting/chartProfile";

/**
 * GET /api/accounting/chart-of-accounts/template
 * ----------------------------------------------------------------------------
 * The standard-heads catalog, split against this society's SocietyChartProfile
 * (see lib/accounting/chartProfile.js): what's missing (never adopted, should
 * be nagged about), what's available to add (missing OR deliberately removed —
 * the Heads page's "Available to add" picker), and which codes already exist.
 * Design doc §12 Phase 3: "Setup-state compares against the profile, not
 * STANDARD_ACCOUNTS."
 */
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, ["accounting.chartOfAccounts.view", "society.systemTests.view"]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { missing, available, existingCodes, removedCodes } = await getTemplateDiff(auth.user.societyId);
    return NextResponse.json({
      missing,
      available,
      existingCodes: [...existingCodes],
      removedCodes: [...removedCodes],
    });
  } catch (error) {
    console.error("[accounting] chart-of-accounts template GET failed:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

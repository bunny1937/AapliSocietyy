import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { validateAdminRequest } from "@/lib/admin-middleware";
import Society from "@/models/Society";
import { purgeSociety } from "@/lib/superadmin/societyPurge";
import { logSocietyLifecycle, SOCIETY_LIFECYCLE_ACTIONS } from "@/lib/superadmin/societyAudit";

// POST /api/superadmin/societies/[id]/quick-delete-test
// The fast lane requested alongside LOOP-05's wizard: skips export/verify
// entirely, but ONLY for societies explicitly flagged isTestSociety on the
// Society document. That flag is never set implicitly — refusing here if
// it's false is the entire safety boundary for this route, so a real
// society can never reach this path no matter what the UI sends.
export async function POST(request, { params }) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  try {
    await connectDB();
    const { id } = await params;
    const society = await Society.findById(id).select("name isTestSociety").lean();
    if (!society) return NextResponse.json({ error: "Society not found" }, { status: 404 });
    if (!society.isTestSociety) {
      return NextResponse.json(
        { error: "This is not marked as a test society. Use the full delete wizard." },
        { status: 403 },
      );
    }

    // Same purge the wizard runs — a test society leaves no more orphans
    // behind than a real one.
    const deleted = await purgeSociety(id);
    await logSocietyLifecycle({
      action: SOCIETY_LIFECYCLE_ACTIONS.QUICK_DELETED,
      societyId: id,
      societyName: society.name,
      actorUserId: validation.admin?.userId,
      details: { trigger: "quick-delete-test", deleted },
    });
    return NextResponse.json({ success: true, societyName: society.name, deleted });
  } catch (err) {
    console.error("quick-delete-test error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

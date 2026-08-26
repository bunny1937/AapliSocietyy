import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { validateAdminRequest } from "@/lib/admin-middleware";
import Society from "@/models/Society";
import { purgeSociety } from "@/lib/superadmin/societyPurge";

// POST /api/superadmin/delete-society
// Body: { societyId }
// Legacy endpoint — the UI now goes through the LOOP-05 wizard
// (/api/superadmin/societies/[id]/lifecycle, which requires a verified
// export first). Kept for scripts, and pointed at the same purgeSociety so
// its blast radius can't fall behind the wizard's.
export async function POST(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  try {
    await connectDB();
    const { societyId } = await request.json();
    if (!societyId) return NextResponse.json({ error: "societyId required" }, { status: 400 });
    const society = await Society.findById(societyId).lean();
    if (!society) return NextResponse.json({ error: "Society not found" }, { status: 404 });

    const deleted = await purgeSociety(societyId);
    return NextResponse.json({ success: true, societyName: society.name, deleted });
  } catch (err) {
    console.error("delete-society error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

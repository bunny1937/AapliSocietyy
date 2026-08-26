import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { validateAdminRequest } from "@/lib/admin-middleware";
import Society from "@/models/Society";

// POST /api/superadmin/societies/[id]/mark-test
// Body: { isTestSociety: boolean }
// Toggles the "(test)" marker that unlocks quick-delete-test for this
// society. Superadmin-only, explicit, one flag at a time — see LOOP-05.
export async function POST(request, { params }) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  try {
    await connectDB();
    const { id } = await params;
    const { isTestSociety } = await request.json();
    const society = await Society.findByIdAndUpdate(
      id,
      { $set: { isTestSociety: Boolean(isTestSociety) } },
      { new: true },
    ).select("name isTestSociety").lean();
    if (!society) return NextResponse.json({ error: "Society not found" }, { status: 404 });
    return NextResponse.json({ success: true, isTestSociety: society.isTestSociety });
  } catch (err) {
    console.error("mark-test error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

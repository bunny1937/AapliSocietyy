import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import cache from "@/lib/cache";
import { authorizeAny } from "@/lib/rbac/authorize";
import { recalcMemberBillForPeriod, BillLockedError } from "@/lib/billing/memberBillRecalc";

export async function POST(request) {
  try {
    // Also called from Generate Bills (inline area/parking fix before
    // generating), not just View/Edit Members.
    const gate = await authorizeAny(request, ["member.member.update", "billing.dashboard.view"]);
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    // Legacy "Admin only" check removed: authorize() above (member.member.update)
    // is the real gate — it correctly allows any role RBAC granted this to,
    // not just the literal legacy string "Admin".
    const societyId = gate.context.societyId || decoded.societyId;
    const { memberId, carpetAreaSqft, parkingSlots, recalcBillPeriodId } = await request.json();
    if (!memberId) return NextResponse.json({ error: "memberId required" }, { status: 400 });

    const patch = {};
    if (carpetAreaSqft !== undefined) patch.carpetAreaSqft = Number(carpetAreaSqft);
    if (parkingSlots !== undefined) patch.parkingSlots = parkingSlots;

    const member = await Member.findOneAndUpdate(
      { _id: memberId, societyId },
      { $set: patch },
      { new: true },
    );
    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    await cache.delPattern(`members:list:${societyId}:*`);

    // The recalculation rules live in lib/billing/memberBillRecalc.js so this
    // endpoint and the member-detail parking editor apply exactly the same
    // payment guard and the same audited correction path.
    let billRecalculated = false;
    let recalcNote = null;
    if (recalcBillPeriodId) {
      const result = await recalcMemberBillForPeriod({
        member,
        societyId,
        billPeriodId: recalcBillPeriodId,
        performedBy: decoded.userId,
        reason: `Member data corrected (carpetAreaSqft/parkingSlots) — bill charges recalculated from BillingHeads for period ${recalcBillPeriodId}`,
      });
      billRecalculated = result.recalculated;
      recalcNote = result.reason ?? null;
    }

    return NextResponse.json({ member: member.toObject(), billRecalculated, recalcNote });
  } catch (err) {
    if (err instanceof BillLockedError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    // The real reason, not a blanket "Internal server error" the admin cannot
    // act on or report.
    console.error("members/quick-patch error:", err);
    return NextResponse.json(
      {
        error: err?.message || "This change could not be saved.",
        code: err?.code || "QUICK_PATCH_FAILED",
      },
      { status: 500 },
    );
  }
}

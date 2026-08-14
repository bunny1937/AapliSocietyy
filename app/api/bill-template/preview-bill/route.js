import { billableArea, areaBasisLabel } from "@/lib/commercial/areaResolver";
// Returns the latest REAL bill for a member so the bill-template designer can
// render an actual filled bill (instead of hardcoded sample numbers) before the
// admin activates a template.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireRoles } from "@/lib/authz";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import Society from "@/models/Society";
import User from "@/models/User";
import { normalizeBillCharges } from "@/lib/bill-charge-normalizer";
void User;

export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = requireRoles(request, ["Admin", "Secretary", "Treasurer"]);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const societyId = auth.user.societyId;
    let memberId = searchParams.get("memberId");

    // Load society config for areaBasis and other template settings
    const society = societyId ? await Society.findById(societyId).select("config").lean() : null;

    if (!memberId) {
      const first = await Member.findOne({ societyId }).select("_id").lean();
      memberId = first?._id;
    }
    if (!memberId) return NextResponse.json({ bill: null, reason: "No members in this society" });

    const member = await Member.findOne({ _id: memberId, societyId })
      .select("ownerName flatNo wing areaSqFt carpetAreaSqft builtUpAreaSqft openingBalance")
      .lean();
    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });

    // Prefer a generated (pushed) bill; fall back to the newest of any status.
    const bill =
      (await Bill.findOne({ societyId, memberId, status: { $ne: "Scheduled" } })
        .sort({ billDate: -1, createdAt: -1 })
        .lean()) ||
      (await Bill.findOne({ societyId, memberId }).sort({ billDate: -1, createdAt: -1 }).lean());

    if (!bill) {
      return NextResponse.json({
        bill: null,
        reason: "This member has no bill generated yet",
        member: { ...member, _id: String(member._id) },
      });
    }

    // Normalise charge rows across the shapes bills have used over time.
    const charges = normalizeBillCharges(bill.charges ?? bill.billItems ?? bill.heads);

    const due = bill.dueDate ? new Date(bill.dueDate) : null;
    const daysOverdue = due ? Math.max(0, Math.floor((Date.now() - due.getTime()) / 86400000)) : 0;

    return NextResponse.json({
      bill: {
        _id: String(bill._id),
        billPeriodId: bill.billPeriodId,
        billDate: bill.billDate,
        dueDate: bill.dueDate,
        status: bill.status,
        charges,
        previousBalance: Number(bill.previousBalance ?? bill.arrears ?? 0),
        interestAmount: Number(bill.interestAmount ?? bill.interest ?? 0),
        totalAmount: Number(bill.totalAmount ?? 0),
        amountPaid: Number(bill.amountPaid ?? 0),
        advanceApplied: Number(bill.advanceApplied ?? 0),
        daysOverdue,
        member: {
          ...member,
          _id: String(member._id),
          // FIXED 2026-08-07 — THIS LINE printed a different area than the one
          // the bill was calculated on. It preferred the legacy imported
          // `areaSqFt`, while both charge engines preferred `carpetAreaSqft`.
          // A-103 reads "Carpet Area 400 sq.ft" on its flat profile and printed
          // "560 sq ft" on its bill. Same resolver as the engines now, and the
          // bill states WHICH area it used.
          areaSqFt: billableArea(member, { areaBasis: society?.config?.areaBasis }),
          areaBasis: areaBasisLabel(member, { areaBasis: society?.config?.areaBasis }),
        },
      },
    });
  } catch (err) {
    console.error("preview-bill error", err);
    return NextResponse.json({ error: "Failed to build preview" }, { status: 500 });
  }
}

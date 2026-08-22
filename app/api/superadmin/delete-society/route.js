import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { validateAdminRequest } from "@/lib/admin-middleware";
import Society from "@/models/Society";
import User from "@/models/User";
import Member from "@/models/Member";
import Bill from "@/models/Bill";
import Receipt from "@/models/Receipt";
import Transaction from "@/models/Transaction";
import BillingHead from "@/models/BillingHead";
import RoleAssignment from "@/models/RoleAssignment";
// POST /api/superadmin/delete-society
// Body: { societyId }
// Hard-deletes society + all associated data
export async function POST(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  try {
    await connectDB();
    const { societyId } = await request.json();
    if (!societyId) return NextResponse.json({ error: "societyId required" }, { status: 400 });
    const society = await Society.findById(societyId).lean();
    if (!society) return NextResponse.json({ error: "Society not found" }, { status: 404 });
    const [bills, receipts, transactions, members, billingHeads, users, roleAssignments] = await Promise.all([
      Bill.deleteMany({ societyId }),
      Receipt.deleteMany({ societyId }),
      Transaction.deleteMany({ societyId }),
      Member.deleteMany({ societyId }),
      BillingHead.deleteMany({ societyId }),
      // Only removes accounts whose root/home societyId is this one. A
      // multi-society admin or a member with a staff role elsewhere keeps
      // their account — see the $pull below for their embedded profile.
      User.deleteMany({ societyId }),
      // RoleAssignment was never touched here — any staff/admin grant on
      // this society (for ANY user, not just ones whose root societyId
      // matches) survived as a dangling record pointing at a deleted
      // society. Same for User.profiles[] entries below.
      RoleAssignment.deleteMany({ societyId }),
    ]);
    // Any user (regardless of their own root societyId) can hold an embedded
    // profiles[] entry for this society (multi-flat/multi-society member) —
    // purge those too, and clear activeProfileId if it pointed here.
    const staleProfileUsers = await User.find({ "profiles.societyId": societyId }).select("_id activeProfileId profiles").lean();
    let profilesPulled = 0;
    for (const u of staleProfileUsers) {
      const removedIds = (u.profiles || [])
        .filter((p) => String(p.societyId) === String(societyId))
        .map((p) => String(p.profileId));
      profilesPulled += removedIds.length;
      const update = { $pull: { profiles: { societyId } } };
      if (removedIds.includes(String(u.activeProfileId))) {
        update.$set = { activeProfileId: null };
      }
      await User.updateOne({ _id: u._id }, update);
    }
    await Society.findByIdAndDelete(societyId);
    return NextResponse.json({
      success: true,
      societyName: society.name,
      deleted: {
        bills: bills.deletedCount,
        receipts: receipts.deletedCount,
        transactions: transactions.deletedCount,
        members: members.deletedCount,
        billingHeads: billingHeads.deletedCount,
        users: users.deletedCount,
        roleAssignments: roleAssignments.deletedCount,
        staleProfilesPulled: profilesPulled,
      },
    });
  } catch (err) {
    console.error("delete-society error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

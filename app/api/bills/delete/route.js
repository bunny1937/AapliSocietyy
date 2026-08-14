import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import User from "@/models/User";
import { exportToAdminDB, logAdminActivity } from "@/lib/export-to-admin-db";
import Transaction from "@/models/Transaction";
import { requireRoles } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
import cache from "@/lib/cache";
export async function POST(request) {
  try {
    const gate = await authorize(request, "billing.bill.delete");
    if (!gate.ok) return gate.response;
    await connectDB();    const decoded = gate.context;
    const { billIds, reason } = await request.json();
    if (!billIds || !Array.isArray(billIds) || billIds.length === 0) {
      return NextResponse.json(
        { error: "Bill IDs are required" },
        { status: 400 },
      );
    }
    if (!reason || reason.trim() === "") {
      return NextResponse.json(
        { error: "Deletion reason is required" },
        { status: 400 },
      );
    }
    // Get user info
    const user = await User.findById(decoded.userId).lean();
    // ✅ STEP 1: FETCH BILLS TO DELETE
    const billsToDelete = await Bill.find({
      _id: { $in: billIds },
      societyId: decoded.societyId,
    }).lean();
    if (billsToDelete.length === 0) {
      return NextResponse.json(
        { error: "No bills found to delete" },
        { status: 404 },
      );
    }
    // Block deletion of locked historical bills
    const lockedBills = billsToDelete.filter(
      (b) => b.isHistoricalArchive || b.isLocked || b.importedFrom === "BulkImport"
    );
    if (lockedBills.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete ${lockedBills.length} historical bill(s) — they are locked audit records and immutable.`,
          lockedBillIds: lockedBills.map((b) => b._id),
        },
        { status: 403 },
      );
    }
    // ✅ STEP 2: EXPORT TO ADMIN.EXPORTS COLLECTION (BEFORE DELETING)
    const exportResult = await exportToAdminDB(billsToDelete, {
      collection: "bills",
      societyId: decoded.societyId,
      deletedBy: decoded.userId,
      deletedByName: user.name,
      deletedByRole: user.role,
      deletionReason: reason,
    });
    // ✅ STEP 3: SOFT DELETE (mark as deleted)
    await Bill.updateMany(
      { _id: { $in: billIds } },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy: decoded.userId,
        },
      },
    );
    // ✅ Also reverse/delete the system Debit transactions created for these bills
    await Transaction.updateMany(
      {
          societyId: decoded.societyId,
        referenceId: { $in: billIds },
        referenceModel: "Bill",
        type: "Debit",
        category: "Maintenance",
        isReversed: { $ne: true },
      },
      {
        $set: {
          isReversed: true,
          reversedAt: new Date(),
          reversedBy: decoded.userId,
        },
      },
    );
    // ✅ STEP 4: LOG ADMIN ACTIVITY
    await logAdminActivity({
      adminId: decoded.userId,
      adminName: user.name,
      action: "DELETE_DATA",
      targetSociety: {
        societyId: decoded.societyId,
        societyName: "Society Name", // Add from context
      },
      details: {
        collection: "bills",
        recordCount: billsToDelete.length,
        reason,
      },
    });
    console.log(`✅ Deleted ${billsToDelete.length} bills`);
    // A deleted bill (and its reversed transaction) must never keep showing
    // up in the mobile app for the members it belonged to.
    await cache.delPattern(`v1:bills:${decoded.societyId}:member:*`);
    await cache.delPattern(`v1:ledger:${decoded.societyId}:member:*`);
    return NextResponse.json({
      success: true,
      message: `${billsToDelete.length} bills deleted and exported to admin database`,
      deleted: billsToDelete.length,
      exportId: exportResult.exportId,
    });
  } catch (error) {
    console.error("Delete bills error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

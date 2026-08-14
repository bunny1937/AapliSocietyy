import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import User from "@/models/User";
import AuditLog from "@/models/AuditLog";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import Receipt from "@/models/Receipt";
import { requireRoles } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
import cache from "@/lib/cache";
export async function DELETE(request, { params }) {
  try {
    const gate = await authorize(request, "society.data.delete");
    if (!gate.ok) return gate.response;
    await connectDB();    const decoded = gate.context;
    const { entity } = await params;
    const { searchParams } = new URL(request.url);
    const ids = searchParams.get("ids")?.split(",") || [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "No IDs provided" }, { status: 400 });
    }
    let Model;
    if (entity === "members") Model = Member;
    else if (entity === "users") Model = User;
    else if (entity === "bills") Model = Bill;
    else if (entity === "transactions") Model = Transaction;
    else if (entity === "receipts") Model = Receipt;
    else return NextResponse.json({ error: "Invalid entity" }, { status: 400 });
    // Perform bulk delete
    const result = await Model.deleteMany({
      _id: { $in: ids },
      societyId: decoded.societyId,
    });
    // If deleting members, also delete associated users
    if (entity === "members") {
      await User.deleteMany({ memberId: { $in: ids } });
    }
    // If deleting bills, also soft-mark related transactions as reversed
    if (entity === "bills") {
      await Transaction.updateMany(
        {
          referenceId: { $in: ids },
          referenceModel: "Bill",
          societyId: decoded.societyId,
        },
        { $set: { isReversed: true } },
      );
    }
    // Audit log
    await AuditLog.create({
      userId: decoded.userId,
      societyId: decoded.societyId,
      action: "DELETE_MEMBER",
      newData: {
        entity: entity,
        deletedCount: result.deletedCount,
        bulkDelete: true,
        deletedIds: ids,
      },
      timestamp: new Date(),
    });
    // IDs deleted here aren't grouped by member, and this tool is rare/
    // dangerous enough that a full society sweep is the right trade - a
    // missed targeted invalidation here would mean a resident's app keeps
    // showing a bill/payment that was just hard-deleted.
    if ((entity === "bills" || entity === "transactions" || entity === "receipts") && result.deletedCount > 0) {
      await cache.delPattern(`v1:bills:${decoded.societyId}:member:*`);
      await cache.delPattern(`v1:ledger:${decoded.societyId}:member:*`);
      await cache.delPattern(`v1:receipts:${decoded.societyId}:member:*`);
    }
    return NextResponse.json({
      success: true,
      message: `Deleted ${result.deletedCount} ${entity}`,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("Delete error:", error);
    return NextResponse.json(
      {
        error: "Delete failed",
      },
      { status: 500 },
    );
  }
}

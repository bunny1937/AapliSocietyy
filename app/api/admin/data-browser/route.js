import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import Transaction from "@/models/Transaction";
import BillingHead from "@/models/BillingHead";
import { validateAdminRequest } from "@/lib/admin-middleware";
import { logAdminActivity } from "@/lib/export-to-admin-db";
import { authorize } from "@/lib/rbac/authorize";
const COLLECTIONS = {
  bills: Bill,
  members: Member,
  transactions: Transaction,
  billingheads: BillingHead,
};
export async function GET(request) {
  // Superadmin FIRST, and if that passes, the society-scoped RBAC gate is
  // skipped entirely.
  //
  // authorize() resolves permissions from the `token` cookie — a society
  // user's session. A superadmin holds `admin_token` (a different cookie,
  // signed with ADMIN_JWT_SECRET, see lib/authz.js requireSuperAdmin) and has
  // no society context at all, so running it first returned 401
  // UNAUTHENTICATED for every superadmin request and locked the platform
  // owner out of the data browser and out of the society detail tabs.
  //
  // Order matters, not just presence: the RBAC gate still guards any
  // society-scoped caller, it simply cannot be the gate a superadmin has to
  // pass through.
  const validation = validateAdminRequest(request);
  if (!validation.valid) {
    const gate = await authorize(request, "society.data.view");
    if (!gate.ok) return gate.response;
  }
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const societyId = searchParams.get("societyId");
    const collection = searchParams.get("collection");
    if (!societyId || !collection || !COLLECTIONS[collection]) {
      return NextResponse.json(
        { error: "Invalid parameters" },
        { status: 400 },
      );
    }
    const Model = COLLECTIONS[collection];
    // Fetch data
    let data = await Model.find({ societyId })
      .limit(1000)
      .sort({ createdAt: -1 })
      .lean();
    // Populate memberId if exists
    if (collection === "bills" || collection === "transactions") {
      data = await Model.find({ societyId })
        .populate("memberId", "wing roomNo ownerName")
        .limit(1000)
        .sort({ createdAt: -1 })
        .lean();
    }
    return NextResponse.json({
      success: true,
      data,
      count: data.length,
      collection,
      societyId,
    });
  } catch (error) {
    console.error("Data browser fetch error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
export async function POST(request) {
  // Superadmin first — see app/api/admin/data-browser/route.js for why.
  // authorize() reads the society-scoped `token` cookie; a superadmin holds
  // `admin_token` and has no society context, so gating on it first returns
  // 401 for the platform owner.
  const validation = validateAdminRequest(request);
  if (!validation.valid) {
    const gate = await authorize(request, "society.data.delete");
    if (!gate.ok) return gate.response;
  }
  try {
    await connectDB();
    const { action, societyId, collection, ids, reason } = await request.json();
    if (action !== "delete" || !societyId || !collection || !ids || !reason) {
      return NextResponse.json(
        { error: "Invalid parameters" },
        { status: 400 },
      );
    }
    if (!COLLECTIONS[collection]) {
      return NextResponse.json(
        { error: "Invalid collection" },
        { status: 400 },
      );
    }
    const Model = COLLECTIONS[collection];
    // Fetch documents to be deleted
    const docsToDelete = await Model.find({
      _id: { $in: ids },
      societyId,
    }).lean();
    if (docsToDelete.length === 0) {
      return NextResponse.json(
        { error: "No documents found to delete" },
        { status: 404 },
      );
    }
    // Export to admin database using your existing function
    const { getAdminModels } = await import("@/lib/admin-models");
    const { Export } = await getAdminModels();
    const exportDoc = await Export.create({
      collection,
      societyId,
      societyName: "Unknown", // You can fetch from Society model if needed
      data: docsToDelete,
      recordCount: docsToDelete.length,
      deletedBy: {
        userId: "superadmin",
        userName: "superadmin",
        role: "SuperAdmin",
      },
      deletionReason: reason,
      deletedAt: new Date(),
      willExpireAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
      isRestored: false,
    });
    // Delete documents
    const deleteResult = await Model.deleteMany({
      _id: { $in: ids },
      societyId,
    });
    await logAdminActivity({
      adminId: "superadmin",
      adminName: "superadmin",
      action: "DELETE_DATA",
      details: { collection, societyId, deletedCount: deleteResult.deletedCount, reason },
      ipAddress: request.headers.get("x-forwarded-for") || "unknown",
      userAgent: request.headers.get("user-agent") || "unknown",
    });
    return NextResponse.json({
      success: true,
      message: `${deleteResult.deletedCount} items deleted and archived for 90 days`,
      deletedCount: deleteResult.deletedCount,
      exportId: exportDoc._id,
    });
  } catch (error) {
    console.error("Delete with export error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import BillingHead from "@/models/BillingHead";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import cache from "@/lib/cache";
import { authorize } from "@/lib/rbac/authorize";
export async function DELETE(request, { params }) {
  try {
    const gate = await authorize(request, "billing.head.delete");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    const { id } = await params;
    const head = await BillingHead.findOneAndUpdate(
      { _id: id, societyId: decoded.societyId },
      {
        $set: {
          isDeleted: true,
          isActive: false,
          deletedAt: new Date(),
          deletedBy: decoded.userId,
        },
      },
      { new: true },
    );
    if (!head) {
      return NextResponse.json(
        { error: "Billing head not found" },
        { status: 404 },
      );
    }
    console.log("✅ Deleted billing head:", head.headName);
    await cache.del(`billing-heads:list:${decoded.societyId}`);
    await cache.del(`society:config:${decoded.societyId}`);
    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("❌ Delete billing head error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
      },
      { status: 500 },
    );
  }
}

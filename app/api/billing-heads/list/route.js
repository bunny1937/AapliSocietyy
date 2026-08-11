import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import BillingHead from "@/models/BillingHead";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import cache from "@/lib/cache";
import { authorizeAny } from "@/lib/rbac/authorize";
// Read by Bill Template, Import Bills and Generate Bills pages too, not just
// Billing Config — same cross-page-dependency pattern as financial-years.
export async function GET(request) {
  try {
    const gate = await authorizeAny(request, [
      "billing.head.view",
      "billing.template.view",
      "billing.importBills.view",
      "billing.dashboard.view",
    ]);
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
    const cacheKey = `billing-heads:list:${decoded.societyId}`;
    const heads = await cache.getOrSet(
      cacheKey,
      () =>
        BillingHead.find({ societyId: decoded.societyId, isDeleted: false })
          .sort({ order: 1 })
          .lean(),
      60,
    );
    return NextResponse.json({ success: true, heads });
  } catch (error) {
    console.error("❌ List billing heads error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
      },
      { status: 500 },
    );
  }
}

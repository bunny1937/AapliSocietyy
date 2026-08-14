import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import BillingHead from "@/models/BillingHead";
import Society from "@/models/Society";
import cache from "@/lib/cache";
import { authorize } from "@/lib/rbac/authorize";
export async function POST(request) {
  try {
    const gate = await authorize(request, "billing.head.create");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    // ← REMOVED: duplicate require("@/models/Society")
    // ← REMOVED: the block that returns 400 if existing > 0
    // Instead: DELETE corrupt docs and re-seed cleanly
    const society = await Society.findById(decoded.societyId).lean();
    if (!society)
      return NextResponse.json({ error: "Society not found" }, { status: 404 });
    // Wipe existing (possibly corrupt) heads for this society
    await BillingHead.deleteMany({ societyId: decoded.societyId });
    const configCharges = society.config?.charges || [];
    // society.config.charges uses { label, value } — but also check { name, amount } variants
    const headsToCreate = configCharges
      .filter((c) => (c.label || c.name)?.trim() && c.isActive !== false)
      .map((c, i) => ({
        headName: (c.label || c.name || "").trim(),
        defaultAmount: Number(c.value ?? c.amount ?? c.defaultAmount) || 0,
        calculationType: c.type === "Per Sq Ft" ? "Per Sq Ft" : "Fixed",
        defaultAmount: Number(c.value) || 0,
        isActive: true,
        order: i + 1,
        societyId: decoded.societyId,
      }));
    if (headsToCreate.length === 0) {
      headsToCreate.push(
        {
          headName: "Maintenance",
          calculationType: "Per Sq Ft",
          defaultAmount: 2,
          isActive: true,
          order: 1,
          societyId: decoded.societyId,
        },
        {
          headName: "Water Charges",
          calculationType: "Fixed",
          defaultAmount: 500,
          isActive: true,
          order: 2,
          societyId: decoded.societyId,
        },
      );
    }
    const created = await BillingHead.insertMany(headsToCreate);
    await cache.del(`billing-heads:list:${decoded.societyId}`);
    await cache.del(`society-config:${decoded.societyId}`);
    return NextResponse.json({
      success: true,
      message: `Migrated ${created.length} billing heads from config`,
      billingHeads: created,
    });
  } catch (error) {
    console.error("Setup error:", error);
    return NextResponse.json(
      { error: "Failed to setup billing heads" },
      { status: 500 },
    );
  }
}

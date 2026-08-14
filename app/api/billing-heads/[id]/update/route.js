import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import BillingHead from "@/models/BillingHead";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import cache from "@/lib/cache";
import { UNIT_CLASS_VALUES } from "@/lib/commercial/constants";
import { normalizeUnitClassRates } from "@/lib/commercial/billingApplicability";
import { authorize } from "@/lib/rbac/authorize";
export async function PUT(request, { params }) {
  try {
    const gate = await authorize(request, "billing.head.update");
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
    if (decoded.role === "Accountant") {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }
    const { id } = await params;
    const updates = await request.json();
    const head = await BillingHead.findOne({
      _id: id,
      societyId: decoded.societyId,
      isDeleted: false,
    });
    if (!head) {
      return NextResponse.json(
        { error: "Billing head not found" },
        { status: 404 },
      );
    }
    // Update allowed fields
    const allowedUpdates = [
      "headName",
      "calculationType",
      "defaultAmount",
      "isActive",
      "order",
    ];
    Object.keys(updates).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        head[key] = updates[key];
      }
    });
    // Optional unit-class restriction. An empty list clears the restriction
    // and returns the head to "applies to every unit" - the legacy behaviour.
    if (updates.appliesToUnitClasses !== undefined) {
      const list = updates.appliesToUnitClasses;
      if (!Array.isArray(list) || !list.every((c) => UNIT_CLASS_VALUES.includes(c))) {
        return NextResponse.json({ error: "Invalid unit class" }, { status: 400 });
      }
      head.appliesToUnitClasses = list.length ? [...new Set(list)] : undefined;
    }
    // Optional per-class rate override. Sending {} or null clears every
    // override and the head goes back to a single rate for all units.
    if (updates.unitClassRates !== undefined) {
      head.unitClassRates = normalizeUnitClassRates(updates.unitClassRates);
    }
    head.lastModifiedAt = new Date();
    head.lastModifiedBy = decoded.userId;
    await head.save();
    await cache.del(`billing-heads:list:${decoded.societyId}`);
    await cache.del(`society:config:${decoded.societyId}`);
    return NextResponse.json({
      success: true,
      message: "Billing head updated successfully",
      head,
    });
  } catch (error) {
    console.error("Update billing head error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
      },
      { status: 500 },
    );
  }
}
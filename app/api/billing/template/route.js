import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import { authorizeAny } from "@/lib/rbac/authorize";
// Only real caller today is the Billing Config page (peripheral template
// preview) — broadened rather than left pointing at the dead billTemplate id.
export async function GET(request) {
  const gate = await authorizeAny(request, [
    "billing.template.view",
    "billing.config.view",
    "billing.head.view",
  ]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    const society = await Society.findById(decoded.societyId).lean();
    return NextResponse.json({
      success: true,
      template: society?.billTemplate || null,
    });
  } catch (error) {
    console.error("Template fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch template" },
      { status: 500 }
    );
  }
}
export async function POST(request) {
  // This wrote society.billTemplate with NO RBAC gate at all — the sibling
  // GET above is gated on billing.template.view/billing.config.view/
  // billing.head.view, but this write only checked
  // `decoded.role === "Accountant"` (excluding just that one role), so any
  // other authenticated staff role — including one with zero billing
  // permissions granted through RBAC — could overwrite the society's bill
  // template. billing.template.update is the permission the sibling
  // app/api/bill-template/save/route.js already gates its own POST on.
  const gate = await authorizeAny(request, ["billing.template.update", "billing.template.upload"]);
  if (!gate.ok) return gate.response;
  try {
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
        { status: 403 }
      );
    }
    const { name, html } = await request.json();
    if (!html || !html.trim()) {
      return NextResponse.json(
        { error: "HTML content is required" },
        { status: 400 }
      );
    }
    const society = await Society.findByIdAndUpdate(
      decoded.societyId,
      {
        billTemplate: {
          name: name || "Default Bill Template",
          html: html.trim(),
          updatedAt: new Date(),
        },
      },
      { new: true }
    );
    return NextResponse.json({
      success: true,
      message: "Template saved successfully",
      template: society.billTemplate,
    });
  } catch (error) {
    console.error("Template save error:", error);
    return NextResponse.json(
      { error: "Failed to save template" },
      { status: 500 }
    );
  }
}

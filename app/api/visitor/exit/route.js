// app/api/visitor/exit/route.js
// PATCH — Security guard logs a visitor's exit (Entered/Approved → Exited).
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import Visitor from "@/models/Visitor";
import { requireSecurity } from "@/lib/authz";
import { logAudit } from "@/lib/audit-logger";
import { authorize } from "@/lib/rbac/authorize";
export async function PATCH(request) {
  const gate = await authorize(request, "visitor.visitor.exit");
  if (!gate.ok) return gate.response;
  const auth = requireSecurity(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { visitorId } = await request.json();
    if (!visitorId || !mongoose.Types.ObjectId.isValid(visitorId))
      return NextResponse.json({ error: "Valid visitorId required" }, { status: 400 });
    const visitor = await Visitor.findOneAndUpdate(
      {
        _id: visitorId,
        societyId: auth.user.societyId,
        status: { $in: ["Entered", "Approved"] },
      },
      { status: "Exited", exitTime: new Date() },
      { new: true },
    );
    if (!visitor)
      return NextResponse.json(
        { error: "Visitor not found or not currently inside" },
        { status: 404 },
      );
    await logAudit(auth.user.userId, auth.user.societyId, "VISITOR_EXITED", null, {
      visitorId: visitor._id.toString(),
    });
    return NextResponse.json({ success: true, exitTime: visitor.exitTime });
  } catch (err) {
    console.error("Visitor exit error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

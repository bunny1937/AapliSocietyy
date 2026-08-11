import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Visitor from "@/models/Visitor";
import Member from "@/models/Member";
import { requireRoles } from "@/lib/authz";
import { logAudit } from "@/lib/audit-logger";
import { authorize } from "@/lib/rbac/authorize";
const ALLOWED_PURPOSES = [
  "Guest",
  "Delivery",
  "Domestic Help",
  "Vendor",
  "Cab",
  "Other",
];
export async function GET(request) {
  const gate = await authorize(request, "visitor.visitor.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const visitors = await Visitor.find({
      societyId: gate.context.societyId,
    })
      .populate("memberId", "flatNo wing ownerName ownershipType currentTenant")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return NextResponse.json({ success: true, visitors });
  } catch (err) {
    console.error("Fetch visitors error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
export async function POST(request) {
  const auth = requireRoles(request, ["Security"]);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const body = await request.json();
    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").trim();
    const photo = String(body.photo || "").trim();
    const purpose = String(body.purpose || "").trim();
    const purposeNote = String(body.purposeNote || "").trim();
    const memberId = String(body.memberId || body.flatId || "").trim();
    if (!ALLOWED_PURPOSES.includes(purpose)) {
      return NextResponse.json({ error: "Invalid purpose" }, { status: 400 });
    }
    if (!name || !memberId || !purpose) {
      return NextResponse.json(
        { error: "name, memberId, purpose required" },
        { status: 400 },
      );
    }
    const member = await Member.findOne({
      _id: memberId,
      societyId: auth.user.societyId,
      isDeleted: { $ne: true },
    })
      .select("flatNo wing ownerName ownershipType currentTenant")
      .lean();
    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    const visitor = await Visitor.create({
      societyId: auth.user.societyId,
      memberId: member._id,
      name,
      phone,
      photo,
      purpose,
      purposeNote,
      status: "Pending",
      entryTime: new Date(),
      enteredBy: auth.user.userId,
      gateLabel: auth.user.gateLabel || "Main Gate",
    });
    await logAudit(
      auth.user.userId,
      auth.user.societyId,
      "VISITOR_CREATED",
      null,
      {
        id: visitor._id,
        memberId: member._id,
        flatNo: member.flatNo,
        wing: member.wing,
        name: visitor.name,
        purpose: visitor.purpose,
        status: visitor.status,
        gateLabel: visitor.gateLabel,
      },
    );
    return NextResponse.json({
      success: true,
      visitor: {
        id: visitor._id,
        name: visitor.name,
        phone: visitor.phone,
        purpose: visitor.purpose,
        purposeNote: visitor.purposeNote,
        status: visitor.status,
        gateLabel: visitor.gateLabel,
        flat: {
          id: member._id,
          flatNo: member.flatNo,
          wing: member.wing,
          ownerName: member.ownerName,
          ownershipType: member.ownershipType,
          currentTenant: member.currentTenant || null,
        },
      },
    });
  } catch (err) {
    console.error("Create visitor error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

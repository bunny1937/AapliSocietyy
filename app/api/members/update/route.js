import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import Bill from "@/models/Bill";
import AuditLog from "@/models/AuditLog";
import { memberSchema } from "@/lib/validators";
import cache from "@/lib/cache";
import { requireRoles, SOCIETY_ADMIN_ROLES } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
export async function PUT(request) {
  try {
    const gate = await authorize(request, "member.member.update");
    if (!gate.ok) return gate.response;
    await connectDB();
    const auth = requireRoles(request, SOCIETY_ADMIN_ROLES);
    if (!auth.valid) return auth;
    const decoded = auth.user;
    const body = await request.json();
    const { memberId, ...updateData } = body;
    if (!memberId) {
      return NextResponse.json(
        { error: "Member ID required" },
        { status: 400 },
      );
    }
    const validationResult = memberSchema.safeParse(updateData);
    if (!validationResult.success) {
      // Field-by-field, in the words the admin needs, rather than a bare
      // "Validation failed" they cannot act on.
      const issues = validationResult.error.issues.map((i) => ({
        field: i.path.join(".") || "form",
        message: i.message,
      }));
      return NextResponse.json(
        {
          error: issues[0]?.message || "Some details could not be saved.",
          code: "VALIDATION_ERROR",
          issues,
        },
        { status: 400 },
      );
    }
    if (Object.keys(validationResult.data).length === 0) {
      return NextResponse.json(
        {
          error: "Nothing was sent to update.",
          code: "EMPTY_UPDATE",
          hint: "Change at least one field before saving.",
        },
        { status: 400 },
      );
    }
    const oldMember = await Member.findOne({
      _id: memberId,
      societyId: decoded.societyId,
    });
    if (!oldMember) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    // Guard: opening balance fields are locked after first bill is generated
    const openingFieldsChanged =
      ("openingPrincipal" in validationResult.data &&
        validationResult.data.openingPrincipal !== oldMember.openingPrincipal) ||
      ("openingInterest" in validationResult.data &&
        validationResult.data.openingInterest !== oldMember.openingInterest);
    if (openingFieldsChanged) {
      const anyBill = await Bill.findOne({
        memberId,
        societyId: decoded.societyId,
        isDeleted: { $ne: true },
      }).select("_id").lean();
      if (anyBill) {
        return NextResponse.json(
          { error: "Opening balances are locked after first bill is generated. Edit them via a ledger adjustment instead." },
          { status: 400 },
        );
      }
    }
    // Always derive openingBalance from the two components — never accept it as independent input
    const finalData = { ...validationResult.data };
    const newPrincipal = finalData.openingPrincipal ?? oldMember.openingPrincipal ?? 0;
    const newInterest = finalData.openingInterest ?? oldMember.openingInterest ?? 0;
    finalData.openingBalance = parseFloat((newPrincipal + newInterest).toFixed(2));
    finalData.lastModifiedBy = decoded.userId;
    const updatedMember = await Member.findByIdAndUpdate(
      memberId,
      { $set: finalData },
      { new: true, runValidators: true },
    );
    await AuditLog.create({
      userId: decoded.userId,
      societyId: decoded.societyId,
      action: "UPDATE_MEMBER",
      oldData: oldMember,
      newData: updatedMember,
      timestamp: new Date(),
    });
    await cache.delPattern(`members:list:${decoded.societyId}:*`);
    return NextResponse.json({
      message: "Member updated successfully",
      member: updatedMember,
    });
  } catch (error) {
    console.error("Update member error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
export async function DELETE(request) {
  const gate = await authorize(request, "member.member.delete");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const decoded = gate.context;
    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get("memberId");
    if (!memberId) {
      return NextResponse.json(
        { error: "Member ID required" },
        { status: 400 },
      );
    }
    const member = await Member.findOneAndDelete({
      _id: memberId,
      societyId: decoded.societyId,
    });
    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    await AuditLog.create({
      userId: decoded.userId,
      societyId: decoded.societyId,
      action: "DELETE_MEMBER",
      oldData: member,
      timestamp: new Date(),
    });
    return NextResponse.json({ message: "Member deleted successfully" });
  } catch (error) {
    console.error("Delete member error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

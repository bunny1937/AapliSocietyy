// POST /api/members/[id]/family
//
// Admin-direct add / edit / remove of a flat's family members.
//
// Until now the ONLY way a family member could change was the mobile app's
// ProfileEditRequest queue — the admin screens rendered the list read-only with
// no way to correct an obviously wrong entry. This is the direct path, and it
// deliberately routes through the SAME applyProfileEditPayload() the approval
// queue uses, so the two can never diverge on what "Add" or "Remove" means.

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import AuditLog from "@/models/AuditLog";
import cache from "@/lib/cache";
import { authorize } from "@/lib/rbac/authorize";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { applyProfileEditPayload } from "@/lib/profile-edit-apply";
import { familyMemberSchema } from "@/lib/validators";

const ACTIONS = new Set(["Add", "Edit", "Remove"]);

export async function POST(request, { params }) {
  try {
    const gate = await authorize(request, "member.member.update");
    if (!gate.ok) return gate.response;
    await connectDB();

    const token = getTokenFromRequest(request);
    const decoded = token ? verifyToken(token) : null;
    if (!decoded) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const societyId = gate.context.societyId || decoded.societyId;

    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "The family member details did not reach the server. Please try again.", code: "BAD_BODY" },
        { status: 400 },
      );
    }

    const action = String(body.action || "");
    if (!ACTIONS.has(action)) {
      return NextResponse.json(
        { error: "Say whether this is an Add, an Edit or a Remove.", code: "BAD_ACTION" },
        { status: 400 },
      );
    }

    // Add and Edit carry real data; Remove only needs the id.
    let payload = {};
    if (action !== "Remove") {
      const shape = action === "Add" ? familyMemberSchema : familyMemberSchema.partial();
      const parsed = shape.safeParse(body.payload ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => ({
          field: i.path.join(".") || "form",
          message: i.message,
        }));
        return NextResponse.json(
          { error: issues[0]?.message || "Those details could not be saved.", code: "VALIDATION_ERROR", issues },
          { status: 400 },
        );
      }
      payload = parsed.data;
    }

    if (action !== "Add" && !body.familyMemberId) {
      return NextResponse.json(
        { error: "Which family member? No id was sent.", code: "NO_TARGET" },
        { status: 400 },
      );
    }

    const member = await Member.findOne({ _id: id, societyId, isDeleted: { $ne: true } });
    if (!member) {
      return NextResponse.json({ error: "That flat could not be found.", code: "NOT_FOUND" }, { status: 404 });
    }

    const before = (member.familyMembers || []).map((f) => f.toObject?.() ?? f);

    try {
      applyProfileEditPayload(member, {
        section: "FamilyMember",
        action,
        familyMemberId: body.familyMemberId,
        payload,
      });
    } catch (err) {
      if (err?.code === "FAMILY_MEMBER_NOT_FOUND") {
        return NextResponse.json(
          {
            error: "That family member is no longer on this flat — someone may have removed them already.",
            code: err.code,
            hint: "Refresh the flat and try again.",
          },
          { status: 404 },
        );
      }
      throw err;
    }

    member.lastModifiedBy = decoded.userId;
    await member.save();
    await cache.delPattern(`members:list:${societyId}:*`);

    await AuditLog.create({
      userId: decoded.userId,
      societyId,
      action: `MEMBER_FAMILY_${action.toUpperCase()}`,
      oldData: { familyMembers: before },
      newData: { familyMembers: member.familyMembers },
      timestamp: new Date(),
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      familyMembers: member.familyMembers,
      message:
        action === "Add"
          ? "Family member added."
          : action === "Remove"
            ? "Family member removed."
            : "Family member updated.",
    });
  } catch (error) {
    console.error("members/[id]/family error:", error);
    return NextResponse.json(
      { error: error?.message || "This change could not be saved.", code: "FAMILY_UPDATE_FAILED" },
      { status: 500 },
    );
  }
}

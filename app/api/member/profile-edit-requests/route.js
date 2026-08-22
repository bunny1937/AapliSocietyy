// GET/POST /api/member/profile-edit-requests
//
// The web half of the resident change-request flow.
//
// The approval queue at /admin/profile-edit-requests and the whole
// ProfileEditRequest model already existed, but the ONLY thing that could ever
// create a request was the mobile app (/api/v1/profile-edit-requests, bearer
// auth). A resident on the website had no way to ask for a family member or a
// parking slot to be corrected — the page simply listed them read-only.
//
// This is the same model, the same zod union and the same statuses, reached
// with the web's httpOnly cookie session instead of a bearer token.

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import ProfileEditRequest from "@/models/ProfileEditRequest";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { authorize } from "@/lib/rbac/authorize";
import { profileEditRequestCreateSchema } from "@/lib/v1/schemas";

function sessionOf(request) {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  const decoded = verifyToken(token);
  if (!decoded) return null;
  if (!decoded.memberId || !decoded.societyId) return null;
  return decoded;
}

export async function GET(request) {
  try {
    // The real RBAC gate — matches app/api/member/profile/route.js, the
    // sibling own-data route this one extends. sessionOf() below is still
    // used afterwards to read the caller's own memberId/societyId claims for
    // scoping the query (authorize() proves permission, not identity).
    const gate = await authorize(request, "member.profile.viewSelf");
    if (!gate.ok) return gate.response;
    await connectDB();
    const decoded = sessionOf(request);
    if (!decoded) {
      return NextResponse.json(
        { error: "Please sign in as a resident to see your change requests.", code: "UNAUTHORIZED" },
        { status: 401 },
      );
    }
    const requests = await ProfileEditRequest.find({
      societyId: decoded.societyId,
      memberId: decoded.memberId,
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return NextResponse.json({
      requests: requests.map((r) => ({ ...r, _id: String(r._id) })),
    });
  } catch (error) {
    console.error("member/profile-edit-requests GET error:", error);
    return NextResponse.json(
      { error: error?.message || "Your change requests could not be loaded." },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  try {
    const gate = await authorize(request, "member.profile.updateSelf");
    if (!gate.ok) return gate.response;
    await connectDB();
    const decoded = sessionOf(request);
    if (!decoded) {
      return NextResponse.json(
        { error: "Please sign in as a resident to request a change.", code: "UNAUTHORIZED" },
        { status: 401 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = profileEditRequestCreateSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({
        field: i.path.join(".") || "form",
        message: i.message,
      }));
      return NextResponse.json(
        {
          error: issues[0]?.message || "Those details could not be sent.",
          code: "VALIDATION_ERROR",
          issues,
        },
        { status: 400 },
      );
    }
    const data = parsed.data;

    // A shop profile edit belongs to the commercial flow, which the web member
    // area does not host — say so rather than silently creating a request
    // nobody will look at.
    if (data.section === "ShopProfile") {
      return NextResponse.json(
        {
          error: "Shop details are changed from the shop owner's own screen, not here.",
          code: "WRONG_SECTION",
        },
        { status: 400 },
      );
    }

    const member = await Member.findOne({
      _id: decoded.memberId,
      societyId: decoded.societyId,
      isDeleted: { $ne: true },
    }).select("_id flatNo");
    if (!member) {
      return NextResponse.json(
        { error: "Your flat record could not be found.", code: "NOT_FOUND" },
        { status: 404 },
      );
    }

    // One pending request per section+target at a time, so an impatient double
    // tap does not fill the admin's queue with duplicates of the same change.
    const duplicate = await ProfileEditRequest.findOne({
      societyId: decoded.societyId,
      memberId: member._id,
      section: data.section,
      action: data.action,
      familyMemberId: data.familyMemberId ?? null,
      status: "Pending",
    }).select("_id");
    if (duplicate) {
      return NextResponse.json(
        {
          error: "You have already asked for this change and it is still waiting for approval.",
          code: "DUPLICATE_PENDING",
          hint: "Your society admin will review it shortly.",
        },
        { status: 409 },
      );
    }

    const created = await ProfileEditRequest.create({
      societyId: decoded.societyId,
      memberId: member._id,
      requestedByUserId: decoded.userId,
      section: data.section,
      action: data.action,
      familyMemberId: data.familyMemberId,
      payload: data.payload ?? {},
      status: "Pending",
    });

    return NextResponse.json(
      {
        request: { ...created.toObject(), _id: String(created._id) },
        message:
          "Your request has been sent to the society admin. You will see the change here once it is approved.",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("member/profile-edit-requests POST error:", error);
    return NextResponse.json(
      { error: error?.message || "Your request could not be sent." },
      { status: 500 },
    );
  }
}

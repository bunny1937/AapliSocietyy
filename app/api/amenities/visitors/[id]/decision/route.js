import AmenityVisitor from "@/models/amenities/AmenityVisitor";
import { amenityVisitorDecisionSchema } from "@/lib/amenities/schemas";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION } from "@/lib/amenities/constants";
import { gate, ok, fail, zodFail, isId, withAmenityRoute, CAPABILITY } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/amenities/visitors/:id/decision — approve or reject a pending
// visitor when the amenity requires approval.
export const POST = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.VERIFY_VISITORS);
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid visitor id");

  const parsed = amenityVisitorDecisionSchema.safeParse(await request.json());
  if (!parsed.success) return zodFail(parsed);

  const visitor = await AmenityVisitor.findOne({ _id: id, societyId: g.societyId });
  if (!visitor) return fail(404, "Visitor record not found");
  if (visitor.status !== "PENDING") {
    return fail(409, `This visitor is already ${visitor.status.toLowerCase().replace("_", " ")}`);
  }

  const approved = parsed.data.decision === "APPROVE";
  visitor.status = approved ? "APPROVED" : "REJECTED";
  visitor.approvedBy = g.actor.userId;
  visitor.approvedAt = new Date();
  visitor.decisionNote = parsed.data.note || "";
  await visitor.save();

  await logAmenityActivity({
    societyId: g.societyId,
    entityType: "VISITOR",
    entityId: visitor._id,
    amenityId: visitor.amenityId,
    amenityName: visitor.amenityName,
    action: approved ? ACTIVITY_ACTION.VISITOR_APPROVED : ACTIVITY_ACTION.VISITOR_REJECTED,
    actor: g.actor,
    newValue: { status: visitor.status, note: visitor.decisionNote },
  });

  return ok({ visitor: visitor.toObject() });
});

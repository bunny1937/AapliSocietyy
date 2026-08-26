import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { Visitor } from "@/lib/v1/models";
import { notifySosAcknowledged } from "@/lib/v1/notify";
import { VISITOR_ACCESS_ROLES } from "@/lib/v1/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /v1/visitors/:id/sos-ack
//
// A guard (or anyone in the affected flat) acknowledges an SOS: "seen, we are
// responding." This is the piece that was missing, and its absence is why the
// app could only ever silence the ONE phone whose STOP button was pressed --
// there was nothing to tell the other household devices, so an SOS raised at
// home kept every other phone in the flat ringing until each was tapped.
//
// Acknowledging also sets escalation.stopped so the gate board stops chasing
// the alert.
// ---------------------------------------------------------------------------
export const POST = withRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const claims = getClaims(req);
  const societyId = requireTenant(claims);

  const visitor = await Visitor.findOne({ _id: id, societyId });
  if (!visitor) throw new ApiError(404, "SOS not found");
  if (visitor.entryMethod !== "SOS") throw new ApiError(400, "Not an SOS alert");

  // Positive check: staff roles may acknowledge any SOS in their society;
  // everyone else may only acknowledge their own flat's SOS. Negative
  // inference on memberId is wrong for profile kinds (e.g. Commercial) that
  // carry neither memberId nor a staff role (LOOP-02).
  const isStaff = VISITOR_ACCESS_ROLES.includes(claims.role);
  const isOwnFlat = Boolean(claims.memberId) && String(visitor.memberId) === String(claims.memberId);
  if (!isStaff && !isOwnFlat) {
    throw new ApiError(403, "Not authorised");
  }
  const isResident = !isStaff && isOwnFlat;

  // Idempotent: two guards tapping at once must not fan out two pushes.
  const existing = visitor.sosAck;
  if (existing && existing.at) {
    return json({ ok: true, alreadyAcknowledged: true, sosAck: existing });
  }

  const body = await req.json().catch(() => ({}));
  const note = String(body.note || "").trim();
  const byName = String(body.byName || "").trim();
  const byRole = isResident ? "Resident" : claims.role || "Security";

  visitor.sosAck = {
    at: new Date(),
    byRole,
    byName: byName || undefined,
    note: note || undefined,
  };
  // Stop the escalation ladder; keep whatever level it had reached for audit.
  const escalation = visitor.escalation || {};
  visitor.escalation = { level: escalation.level || 0, stopped: true };
  visitor.markModified("sosAck");
  await visitor.save();

  await notifySosAcknowledged({
    societyId,
    memberId: visitor.memberId,
    visitorId: visitor._id,
    byRole,
    byName,
    note,
  });

  return json({ ok: true, sosAck: visitor.sosAck });
});

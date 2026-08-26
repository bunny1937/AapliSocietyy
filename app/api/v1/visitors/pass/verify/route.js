import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims, requireRoles, requireTenant } from "@/lib/v1/auth";
import { passVerifySchema } from "@/lib/v1/schemas";
import { VisitorPass, Visitor } from "@/lib/v1/models";
import { VISITOR_ACCESS_ROLES } from "@/lib/v1/constants";
import { sha256, isPassUsableNow } from "@/lib/v1/visitorUtils";
import { notifyVisitorChange } from "@/lib/v1/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /v1/visitors/pass/verify — guard verifies an OTP/QR at the gate. On
// success, records a visitor entry against the pass and increments usage.
export const POST = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  requireRoles(claims, VISITOR_ACCESS_ROLES);
  const body = await req.json().catch(() => ({}));
  const parsed = passVerifySchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);

  const hash = sha256(parsed.data.code);
  const now = new Date();

  // Atomic claim: the $expr guard re-checks maxUses against the usedAt array
  // length inside the same update, so two concurrent requests against a
  // single-use pass cannot both succeed (SEC-08).
  const pass = await VisitorPass.findOneAndUpdate(
    {
      societyId,
      $or: [{ otpHash: hash }, { qrTokenHash: hash }],
      status: "Active",
      $and: [
        { $or: [{ validFrom: { $exists: false } }, { validFrom: { $lte: now } }] },
        { $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gte: now } }] },
        { $expr: { $or: [
          { $lte: [{ $ifNull: ["$maxUses", 0] }, 0] },
          { $lt: [{ $size: { $ifNull: ["$usedAt", []] } }, "$maxUses"] },
        ] } },
      ],
    },
    { $push: { usedAt: now } },
    { new: true },
  );

  if (!pass) {
    const exists = await VisitorPass.exists({ societyId, $or: [{ otpHash: hash }, { qrTokenHash: hash }] });
    throw exists ? new ApiError(409, "Pass is not usable right now") : new ApiError(404, "Invalid pass code");
  }

  // Recurrence window (day-of-week/time-of-day) can't be expressed cleanly in
  // the atomic filter above; check it post-claim and release the use if it fails.
  if (!isPassUsableNow(pass, now)) {
    await VisitorPass.updateOne({ _id: pass._id }, { $pull: { usedAt: now } });
    throw new ApiError(409, "Pass is not usable right now");
  }

  if (pass.maxUses && pass.maxUses > 0 && pass.usedAt.length >= pass.maxUses && pass.status !== "Used") {
    await VisitorPass.updateOne({ _id: pass._id }, { $set: { status: "Used" } });
  }

  const visitor = await Visitor.create({
    societyId,
    memberId: pass.memberId,
    name: pass.visitorName,
    phone: pass.visitorPhone || "0000000000",
    purpose: pass.purpose,
    vehicleNumber: pass.vehicleNumber,
    status: "Entered",
    entryMethod: "Pass",
    passId: pass._id,
    entryTime: new Date(),
    enteredBy: claims.userId,
  });

  await notifyVisitorChange({
    visitorId: visitor._id,
    societyId,
    memberId: pass.memberId,
    status: "Entered",
    entryMethod: "Pass",
    isBlacklisted: false,
  });

  return json({ ok: true, visitor });
});

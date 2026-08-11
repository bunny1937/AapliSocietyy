import Amenity from "@/models/amenities/Amenity";
import AmenityQrToken from "@/models/amenities/AmenityQrToken";
import AmenityQrScan from "@/models/amenities/AmenityQrScan";
import { qrGenerateSchema } from "@/lib/amenities/schemas";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION, ATTENDANCE_MODE } from "@/lib/amenities/constants";
import { generateToken, revokeToken, buildQrPayloadForDisplay } from "@/lib/amenities/qrService";
import { getSettings, isFeatureEnabled } from "@/lib/amenities/settingsService";
import { gate, ok, created, fail, zodFail, isId, withAmenityRoute, CAPABILITY } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET — token history and recent scan outcomes. The plaintext token is never
// returned here; only the generation response carries it.
export const GET = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.CONFIGURE_QR);
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid amenity id");

  const [tokens, recentScans] = await Promise.all([
    AmenityQrToken.find({ amenityId: id, societyId: g.societyId }).select("-tokenHash").sort({ createdAt: -1 }).lean(),
    AmenityQrScan.find({ amenityId: id, societyId: g.societyId }).sort({ scannedAt: -1 }).limit(50).lean(),
  ]);

  return ok({ tokens, recentScans, activeToken: tokens.find((t) => t.isActive) || null });
});

// POST — mint a token. The plaintext is returned exactly once: the client must
// render/print it now, because only its hash is stored.
export const POST = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.CONFIGURE_QR);
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid amenity id");

  const parsed = qrGenerateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return zodFail(parsed);

  const amenity = await Amenity.findOne({ _id: id, societyId: g.societyId, isDeleted: false }).lean();
  if (!amenity) return fail(404, "Amenity not found");

  if (![ATTENDANCE_MODE.QR, ATTENDANCE_MODE.QR_MANUAL].includes(amenity.attendanceMode)) {
    return fail(409, "Set this amenity's attendance mode to QR before generating a code");
  }

  const settings = await getSettings(g.societyId);
  // Dynamic rotation is a deferred capability; the schema supports it, the flag
  // decides whether it can be used.
  if (parsed.data.mode === "DYNAMIC" && !isFeatureEnabled(settings, "dynamicQrRotation", amenity)) {
    return fail(409, "Dynamic QR rotation is not enabled for this society");
  }

  const { token, doc } = await generateToken({
    societyId: g.societyId,
    amenityId: id,
    mode: parsed.data.mode || "STATIC",
    label: parsed.data.label || amenity.name,
    locationHint: parsed.data.locationHint || amenity.location || "",
    rotationIntervalMins: parsed.data.rotationIntervalMins ?? null,
    expiresAt: parsed.data.expiresAt ?? null,
    generatedBy: g.actor.userId,
  });

  await logAmenityActivity({
    societyId: g.societyId,
    entityType: "QR",
    entityId: doc._id,
    amenityId: amenity._id,
    amenityName: amenity.name,
    action: ACTIVITY_ACTION.QR_GENERATED,
    actor: g.actor,
    newValue: { mode: doc.mode, version: doc.version },
    note: `QR v${doc.version} generated (previous code revoked)`,
  });

  return created({
    // Show-once payload.
    qr: buildQrPayloadForDisplay(doc, token),
    token: { ...doc.toObject(), tokenHash: undefined },
  });
});

// DELETE ?tokenId= — revoke a printed code (e.g. the sticker was photographed
// and shared in a WhatsApp group).
export const DELETE = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.CONFIGURE_QR);
  if (!g.ok) return g.response;
  const { id } = await params;
  const tokenId = new URL(request.url).searchParams.get("tokenId");
  if (!isId(id) || !isId(tokenId)) return fail(400, "Invalid id");

  const token = await AmenityQrToken.findOne({ _id: tokenId, amenityId: id, societyId: g.societyId }).lean();
  if (!token) return fail(404, "QR token not found");

  await revokeToken({ tokenId, userId: g.actor.userId });

  await logAmenityActivity({
    societyId: g.societyId,
    entityType: "QR",
    entityId: token._id,
    amenityId: id,
    action: ACTIVITY_ACTION.QR_REVOKED,
    actor: g.actor,
    oldValue: { version: token.version, mode: token.mode },
  });

  return ok({ revoked: true });
});

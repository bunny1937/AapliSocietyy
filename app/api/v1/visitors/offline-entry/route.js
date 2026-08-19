import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims, requireRoles, requireTenant } from "@/lib/v1/auth";
import { offlineEntrySchema } from "@/lib/v1/schemas";
import { isDuplicateKeyError } from "@/lib/mongoErrors";
import { Visitor } from "@/lib/v1/models";
import { VISITOR_ACCESS_ROLES } from "@/lib/v1/constants";
import { notifyVisitorChange } from "@/lib/v1/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /v1/visitors/offline-entry — guard syncs an entry captured while the
// device was offline. Idempotent on (societyId, offlineMeta.clientRef) via the
// partial unique index; a duplicate clientRef returns the existing row.
export const POST = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  requireRoles(claims, VISITOR_ACCESS_ROLES);
  const body = await req.json().catch(() => ({}));
  const parsed = offlineEntrySchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);
  const data = parsed.data;

  const existing = await Visitor.findOne({ societyId, "offlineMeta.clientRef": data.clientRef });
  // Same contract as /visitors/guard-request: visitorId is always top-level so
  // the client can immediately attach the gate photo.
  if (existing) return json({ ok: true, visitorId: String(existing._id), visitor: existing, deduped: true });

  try {
    const visitor = await Visitor.create({
      societyId,
      name: data.name,
      phone: data.phone || "0000000000",
      purpose: data.purpose,
      vehicleNumber: data.vehicleNumber,
      status: "Entered",
      entryMethod: "OfflineEntry",
      enteredBy: claims.userId,
      entryTime: new Date(data.queuedAt),
      offlineMeta: {
        wasOffline: true,
        queuedAt: new Date(data.queuedAt),
        syncedAt: new Date(),
        note: data.note,
        clientRef: data.clientRef,
      },
    });
    await notifyVisitorChange({
      visitorId: visitor._id,
      societyId,
      memberId: null,
      status: "Entered",
      entryMethod: "OfflineEntry",
      isBlacklisted: false,
    });
    return json({ ok: true, visitorId: String(visitor._id), visitor }, { status: 201 });
  } catch (e) {
    // Concurrent sync of the same clientRef: return the winner.
    if (isDuplicateKeyError(e)) {
      const winner = await Visitor.findOne({ societyId, "offlineMeta.clientRef": data.clientRef });
      if (winner) return json({ ok: true, visitorId: String(winner._id), visitor: winner, deduped: true });
    }
    throw e;
  }
});
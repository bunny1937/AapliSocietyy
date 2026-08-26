import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import SocietyHandover from "@/models/SocietyHandover";
import Society from "@/models/Society";
import { requireRoles, SOCIETY_ADMIN_ROLES } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/society-handover
//
// The society's own view of its handover: what is waiting for them, what they
// have already collected, what they confirmed.
//
// This prefix is the single carve-out from middleware.js's pause gate (see
// isHandoverPath there). A society in its grace window is locked out of the
// rest of the app, so without the exemption the "come and collect your
// records" email would land on a 403. Auth is unchanged — Admin/Secretary of
// this society, and every query below is scoped by the societyId on their own
// token, never by one from the request.
export async function GET(request) {
  try {
    await connectDB();
    const auth = requireRoles(request, SOCIETY_ADMIN_ROLES);
    if (!auth.valid) return auth;
    const { societyId } = auth.user;

    const handover = await SocietyHandover.findOne({
      societyId,
      status: { $ne: "superseded" },
    })
      .sort({ createdAt: -1 })
      // The manifest holds one leaf per field — megabytes, and useless to the
      // page. The salt is an HMAC key and never leaves the server.
      .select("-manifest -salt")
      .lean();

    const society = await Society.findById(societyId)
      .select("name isDeleted purgeScheduledFor lifecycleStatus")
      .lean();

    return NextResponse.json({
      societyName: society?.name || null,
      // The society is entitled to know its own deletion is scheduled and when.
      scheduledErasure: society?.isDeleted ? society?.purgeScheduledFor || null : null,
      handover: handover
        ? {
            id: handover._id,
            createdAt: handover.createdAt,
            status: handover.status,
            counts: handover.counts,
            manifestRoot: handover.manifestRoot,
            // Digests of what was certified at build time, and of what was
            // actually streamed if they have already downloaded once. The
            // confirm step compares the browser's hash against the delivered
            // set when there is one.
            artifacts: handover.artifacts,
            deliveredArtifacts: handover.deliveredArtifacts || [],
            notifiedAt: handover.notifiedAt,
            downloadedAt: handover.downloadedAt,
            confirmedAt: handover.confirmedAt,
            driftCheckedAt: handover.driftCheckedAt,
            driftMismatchCount: handover.driftMismatchCount,
          }
        : null,
    });
  } catch (err) {
    console.error("society-handover status error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

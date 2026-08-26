import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import SocietyHandover from "@/models/SocietyHandover";
import { requireRoles, SOCIETY_ADMIN_ROLES } from "@/lib/authz";
import { buildSocietyArtifacts } from "@/lib/superadmin/societyArtifacts";
import { buildManifest, diffManifests } from "@/lib/superadmin/societyManifest";
import { logSocietyLifecycle, SOCIETY_LIFECYCLE_ACTIONS } from "@/lib/superadmin/societyAudit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/v1/society-handover/download?format=json|xlsx
//
// Builds the society's copy **now, in memory** and streams it. Nothing was
// stored when the handover was created and nothing is stored here — the same
// judgement as app/api/v1/retention/archives/[id]/download.
//
// ## Rebuilt, not replayed
//
// The bytes are regenerated from live data rather than served from a saved
// file, because no saved file exists. That is the point, but it has a
// consequence worth being explicit about: a download taken days after the
// handover was built can legitimately differ from what was certified then.
//
// So this route rebuilds with the handover's **stored salt**, recomputes the
// manifest, and diffs it against the stored one. The result is recorded on the
// handover (driftMismatchCount) and returned in a header, so the page can tell
// the recipient the truth — "this is identical to what we certified", or "N
// fields changed since, here they are" — instead of quietly handing over a
// file whose hash will not match the email.
//
// ## The download is the receipt
//
// Completing a download stamps downloadedAt. That stamp — never notifiedAt —
// is what the purge cron and the offboarding wizard treat as evidence the
// society actually has its records. A dispatched email proves nothing.
//
// Ordering matters: the bytes are built and hashed BEFORE anything is written.
// If the build throws, the handover stays exactly as it was.
export async function GET(request) {
  try {
    await connectDB();
    const auth = requireRoles(request, SOCIETY_ADMIN_ROLES);
    if (!auth.valid) return auth;
    const { societyId, userId, name } = auth.user;

    const format =
      new URL(request.url).searchParams.get("format") === "xlsx" ? "xlsx" : "json";

    const handover = await SocietyHandover.findOne({
      societyId,
      status: { $ne: "superseded" },
    })
      .sort({ createdAt: -1 })
      .lean();
    if (!handover) {
      return NextResponse.json(
        { error: "There is no handover waiting for your society." },
        { status: 404 },
      );
    }

    // Same salt as the stored manifest, or the two are not comparable at all.
    const built = await buildSocietyArtifacts(societyId, { salt: handover.salt });
    if (!built) {
      return NextResponse.json(
        {
          error: "This society's data is no longer available",
          detail:
            "The records were erased after the grace period ended. Use the copy downloaded on " +
            (handover.downloadedAt
              ? new Date(handover.downloadedAt).toLocaleDateString("en-IN")
              : "the date in your email"),
        },
        { status: 410 },
      );
    }

    const liveManifest = buildManifest(built.bundle, handover.salt);
    const drift = diffManifests(handover.manifest, liveManifest);

    const chosen = built[format];
    const delivered = {
      format,
      filename: chosen.filename,
      sha256: chosen.sha256,
      bytes: chosen.bytes,
      at: new Date(),
    };

    // Only now, with the bytes in hand.
    await SocietyHandover.updateOne(
      { _id: handover._id },
      {
        $set: {
          status: handover.status === "confirmed" ? "confirmed" : "downloaded",
          downloadedAt: handover.downloadedAt ?? new Date(),
          downloadedByUserId: handover.downloadedByUserId ?? userId ?? null,
          driftCheckedAt: new Date(),
          driftMismatchCount: drift.mismatchCount,
        },
        // One entry per format so both files can be confirmed independently.
        $pull: { deliveredArtifacts: { format } },
      },
    );
    await SocietyHandover.updateOne(
      { _id: handover._id },
      { $push: { deliveredArtifacts: delivered } },
    );

    await logSocietyLifecycle({
      action: SOCIETY_LIFECYCLE_ACTIONS.HANDOVER_DOWNLOADED,
      societyId,
      societyName: handover.societyName,
      actorUserId: userId,
      details: {
        handoverId: String(handover._id),
        format,
        sha256: chosen.sha256,
        by: name || String(userId || "unknown"),
        driftMismatchCount: drift.mismatchCount,
      },
    });

    return new NextResponse(chosen.buffer, {
      status: 200,
      headers: {
        "Content-Type":
          format === "xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "application/json",
        "Content-Disposition": `attachment; filename="${chosen.filename}"`,
        "Content-Length": String(chosen.buffer.length),
        // Per-society data behind auth; an intermediary caching this would be
        // a cross-tenant leak.
        "Cache-Control": "private, no-store, max-age=0",
        // The page reads these back to verify the file it just received against
        // the hash computed in the browser.
        "X-Export-SHA256": chosen.sha256,
        "X-Export-Manifest-Root": liveManifest.root,
        "X-Handover-Drift": String(drift.mismatchCount),
      },
    });
  } catch (err) {
    console.error("society-handover download error:", err);
    return NextResponse.json({ error: "Failed to build your records" }, { status: 500 });
  }
}

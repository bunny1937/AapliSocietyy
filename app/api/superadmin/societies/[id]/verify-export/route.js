import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { validateAdminRequest } from "@/lib/admin-middleware";
import Society from "@/models/Society";
import SocietyHandover from "@/models/SocietyHandover";
import { BUNDLE_FORMAT_VERSION } from "@/lib/superadmin/societyBundle";
import { buildSocietyArtifacts } from "@/lib/superadmin/societyArtifacts";
import { buildManifest, diffManifests } from "@/lib/superadmin/societyManifest";
import { logSocietyLifecycle, SOCIETY_LIFECYCLE_ACTIONS } from "@/lib/superadmin/societyAudit";
import cache from "@/lib/cache";
import crypto from "crypto";
import { graceBounds } from "@/lib/superadmin/societyGrace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/superadmin/societies/[id]/verify-export
// Body: none.
//
// ## What changed, and why (C2)
//
// This used to take the exported JSON file back as an upload and diff it
// field-by-field against the database. That worked, but it required the
// operator to be holding a complete copy of a society's personal data on their
// own machine and then to send it back over the wire — two copies of the data
// created, and one of them on a laptop we do not control, purely to answer a
// question that never needed the data at all.
//
// The question this step actually asks is "has the database moved since the
// handover was certified?". That is answered entirely from the manifest: the
// live state is rebuilt with the handover's stored salt and the two manifests
// are diffed. Field-level precision survives; nothing is uploaded, nothing is
// downloaded, and the operator holds nothing.
//
// The other half of the old check — "is the file intact?" — belongs to whoever
// is holding the file, which is now the society. Their browser answers it with
// crypto.subtle at /admin/data-handover, and the answer lands on the same
// SocietyHandover record. See app/api/v1/society-handover/confirm.
//
// ## What it still gates
//
// A clean diff mints the same 15-minute token /lifecycle requires for
// delete-until and delete-permanently, and writes the same durable provenance
// the purge cron reads days later. Nothing downstream changed.
export async function POST(request, { params }) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  try {
    await connectDB();
    const { id } = await params;

    // There is nothing to verify against until a handover has been built —
    // the manifest and its salt are created there. This is also what forces
    // the wizard's order: hand the society its records first, then check.
    const handover = await SocietyHandover.findOne({
      societyId: id,
      status: { $ne: "superseded" },
    })
      .sort({ createdAt: -1 })
      .lean();
    if (!handover) {
      return NextResponse.json(
        {
          error: "No handover has been prepared for this society yet",
          detail:
            "Build and send the society's copy of its records first — verification compares the live database against the manifest recorded at that moment.",
          code: "NO_HANDOVER",
        },
        { status: 409 },
      );
    }

    const built = await buildSocietyArtifacts(id, { salt: handover.salt });
    if (!built) return NextResponse.json({ error: "Society not found" }, { status: 404 });

    const live = buildManifest(built.bundle, handover.salt);
    const result = diffManifests(handover.manifest, live);

    const report = {
      sections: result.sections.filter((s) => s.status !== "empty"),
      skipped: result.sections.filter((s) => s.status === "empty"),
      totals: result.totals,
      certifiedAt: handover.createdAt,
      verifiedAt: new Date(),
      manifestRoot: handover.manifestRoot,
      liveRoot: live.root,
      // The society's own side of the check, so both halves are visible in one
      // place rather than the operator having to guess whether anyone
      // collected anything.
      handover: {
        id: String(handover._id),
        status: handover.status,
        recipients: handover.recipients,
        notifiedAt: handover.notifiedAt,
        downloadedAt: handover.downloadedAt,
        confirmedAt: handover.confirmedAt,
      },
    };

    if (!result.ok) {
      // No values are returned, because none are kept — a manifest holds
      // salted digests, not data. The change list says which document and
      // which field moved, which is what an operator needs to decide whether
      // to re-issue the handover.
      return NextResponse.json({
        ok: false,
        mismatchCount: result.mismatchCount,
        mismatches: result.changes,
        report,
      });
    }

    const verificationToken = crypto.randomUUID();
    await cache.set(`society-delete-verified:${id}`, verificationToken, 900); // 15 min window to act

    const totals = result.totals || {};
    const society = await Society.findByIdAndUpdate(
      id,
      {
        $set: {
          "offboarding.exportVerifiedAt": new Date(),
          "offboarding.exportVerifiedByUserId": validation.admin?.userId || null,
          "offboarding.exportFormatVersion": BUNDLE_FORMAT_VERSION,
          "offboarding.verifiedCounts": {
            collections: totals.collections || 0,
            documents: totals.documents || 0,
            fields: totals.fields || 0,
          },
        },
      },
      { new: true, select: "name offboarding" },
    ).lean();

    await logSocietyLifecycle({
      action: SOCIETY_LIFECYCLE_ACTIONS.EXPORT_VERIFIED,
      societyId: id,
      societyName: society?.name,
      actorUserId: validation.admin?.userId,
      details: {
        ...totals,
        formatVersion: BUNDLE_FORMAT_VERSION,
        method: "manifest-diff",
        handoverId: String(handover._id),
        manifestRoot: handover.manifestRoot,
      },
    });

    // Sent with the token so the wizard's date picker can constrain itself to
    // the same window the lifecycle route will enforce, rather than letting
    // the operator pick a date that is then rejected.
    return NextResponse.json({
      ok: true,
      verificationToken,
      expiresInSeconds: 900,
      report,
      graceBounds: graceBounds(Date.now(), {
        overrideDays: society?.offboarding?.graceDaysOverride,
      }),
    });
  } catch (err) {
    console.error("society verify-export error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

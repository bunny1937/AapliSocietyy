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

// POST /api/v1/society-handover/confirm
// Body: { digests: [{ format: "json"|"xlsx", sha256: "<hex>" }] }
//
// The replacement for "download the export, then upload it back to prove it
// matched". That old step conflated two different questions and answered
// neither well:
//
//   1. Is the file I am holding intact and complete?
//   2. Does it still match what is in the database?
//
// (1) needs nothing but a hash. The browser computes SHA-256 over the file the
// recipient actually holds — with crypto.subtle.digest, entirely client-side —
// and sends 64 characters. The file never leaves their machine, so the
// platform never takes a second copy of personal data it just handed over.
// That was the whole legal objection to the upload step.
//
// (2) needs nothing from the recipient at all. The server rebuilds the
// manifest from live data with the stored salt and diffs it against the one
// certified at handover time. Field-level precision survives, without the
// payload ever moving.
//
// A mismatch on (1) means a corrupt or truncated download: tell them to
// download again. A mismatch on (2) means the database moved after the
// handover: expected during a grace window, and reported rather than hidden.
export async function POST(request) {
  try {
    await connectDB();
    const auth = requireRoles(request, SOCIETY_ADMIN_ROLES);
    if (!auth.valid) return auth;
    const { societyId, userId } = auth.user;

    const body = await request.json().catch(() => ({}));
    const digests = Array.isArray(body.digests) ? body.digests : [];
    if (!digests.length) {
      return NextResponse.json({ error: "No digests supplied" }, { status: 400 });
    }

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

    // ── (1) file integrity ────────────────────────────────────────────────
    // Compared against what was actually streamed where we have it, falling
    // back to what was certified at build time. Using the built digest alone
    // would fail every download taken after any data movement, for a file that
    // is in fact perfectly intact.
    const expectedFor = (format) => {
      const d = (handover.deliveredArtifacts || []).find((a) => a.format === format);
      const b = (handover.artifacts || []).find((a) => a.format === format);
      return {
        sha256: d?.sha256 || b?.sha256 || null,
        source: d ? "delivered" : b ? "certified" : null,
        filename: d?.filename || b?.filename || null,
      };
    };

    const files = digests.map(({ format, sha256 }) => {
      const expected = expectedFor(format);
      const given = String(sha256 || "").toLowerCase();
      return {
        format,
        filename: expected.filename,
        expected: expected.sha256,
        actual: given,
        comparedAgainst: expected.source,
        ok: Boolean(expected.sha256) && expected.sha256.toLowerCase() === given,
      };
    });
    const filesOk = files.every((f) => f.ok);

    // ── (2) database state ────────────────────────────────────────────────
    let drift = null;
    const built = await buildSocietyArtifacts(societyId, { salt: handover.salt });
    if (built) {
      drift = diffManifests(handover.manifest, buildManifest(built.bundle, handover.salt));
    }

    // Confirmation records custody of the file. Drift is reported alongside it
    // but does not block it: the recipient genuinely does hold a complete,
    // intact copy of the society as it stood, and that is what they are
    // confirming. Refusing to record custody because a bill was paid in the
    // meantime would be wrong, and would leave the purge gate unsatisfiable.
    if (filesOk) {
      await SocietyHandover.updateOne(
        { _id: handover._id },
        {
          $set: {
            status: "confirmed",
            confirmedAt: handover.confirmedAt ?? new Date(),
            confirmedByUserId: handover.confirmedByUserId ?? userId ?? null,
            confirmedDigests: files.map((f) => ({ format: f.format, sha256: f.actual })),
            driftCheckedAt: new Date(),
            ...(drift ? { driftMismatchCount: drift.mismatchCount } : {}),
          },
        },
      );
      await logSocietyLifecycle({
        action: SOCIETY_LIFECYCLE_ACTIONS.HANDOVER_CONFIRMED,
        societyId,
        societyName: handover.societyName,
        actorUserId: userId,
        details: {
          handoverId: String(handover._id),
          digests: files.map((f) => `${f.format}:${f.actual}`),
          driftMismatchCount: drift?.mismatchCount ?? null,
        },
      });
    }

    return NextResponse.json({
      ok: filesOk,
      files,
      counts: handover.counts,
      manifestRoot: handover.manifestRoot,
      database: drift
        ? {
            ok: drift.ok,
            mismatchCount: drift.mismatchCount,
            sections: drift.sections,
            totals: drift.totals,
            // Bounded — a full drift list on a large society is unreadable and
            // the sections table already carries the shape of it.
            changes: (drift.changes || []).slice(0, 200),
            truncated: (drift.changes || []).length > 200,
          }
        : {
            ok: false,
            unavailable: true,
            message: "The society's data has already been erased; live comparison is no longer possible.",
          },
      confirmedAt: filesOk ? new Date() : null,
    });
  } catch (err) {
    console.error("society-handover confirm error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

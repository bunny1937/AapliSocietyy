import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { validateAdminRequest } from "@/lib/admin-middleware";
import { buildSocietyArtifacts } from "@/lib/superadmin/societyArtifacts";
import { logSocietyLifecycle, SOCIETY_LIFECYCLE_ACTIONS } from "@/lib/superadmin/societyAudit";
import { breakGlassAuthorized, breakGlassRefusal } from "@/lib/superadmin/breakGlass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/superadmin/societies/[id]/export?reason=<why>[&format=xlsx]
//
// ## This is break-glass now (C1)
//
// It used to be step 1 of the delete wizard: the operator downloaded a
// complete copy of a society's personal data — every member, every phone
// number, every bill — onto their own machine, as the *normal* path, every
// single time a society was offboarded.
//
// That was the sharpest compliance problem in the whole flow, and it was ours,
// not the society's. We are the processor. A copy of a society's records
// sitting on an operator's laptop is a disclosure we cannot account for, could
// not erase on request, and would have to report if the laptop were lost.
//
// The normal path no longer does this. The society receives its own copy
// directly (POST .../handover), and verification is a manifest diff that moves
// no data at all (POST .../verify-export). Neither produces a file here.
//
// What survives is the case those two cannot serve: a regulator's demand, a
// court order, a support investigation that genuinely needs the bytes. So the
// endpoint stays, and the cost of using it is that it is recorded as what it
// is — a named person, a written reason, in an audit row that outlives the
// society itself.
//
// A minimum reason length is not bureaucracy. "export" or "test" in a
// year-old audit log is indistinguishable from an unexplained data pull, which
// is exactly what an auditor would treat it as.

const MIN_REASON_LENGTH = 20;

export async function GET(request, { params }) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  try {
    await connectDB();
    const { id } = await params;
    const url = new URL(request.url);
    const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "json";
    const reason = (url.searchParams.get("reason") || "").trim();

    // D7 — not every superadmin. See lib/superadmin/breakGlass.js.
    if (!breakGlassAuthorized(validation.admin)) {
      return NextResponse.json(
        breakGlassRefusal("Exporting a society's data to your own machine"),
        { status: 403 },
      );
    }

    if (reason.length < MIN_REASON_LENGTH) {
      return NextResponse.json(
        {
          error: "A written reason is required to export a society's data to your own machine",
          detail:
            `This is a break-glass action, recorded against your name permanently. Give at least ${MIN_REASON_LENGTH} characters saying why the normal handover flow will not do. ` +
            "For an ordinary offboarding, use the handover instead — it sends the society its own copy and needs no file on your machine.",
          code: "REASON_REQUIRED",
        },
        { status: 400 },
      );
    }

    const artifacts = await buildSocietyArtifacts(id);
    if (!artifacts) return NextResponse.json({ error: "Society not found" }, { status: 404 });

    const { bundle, manifest } = artifacts;
    const chosen = artifacts[format];

    // Written before the bytes leave, so an export that is interrupted
    // mid-stream is still on the record.
    await logSocietyLifecycle({
      action: SOCIETY_LIFECYCLE_ACTIONS.EXPORT_DOWNLOADED,
      societyId: id,
      societyName: bundle.society?.name,
      actorUserId: validation.admin?.userId,
      details: {
        breakGlass: true,
        reason,
        format,
        sha256: chosen.sha256,
        manifestRoot: manifest.root,
        ...manifest.counts,
      },
    });

    return new NextResponse(chosen.buffer, {
      headers: {
        "Content-Type":
          format === "xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "application/json",
        "Content-Disposition": `attachment; filename="${chosen.filename}"`,
        "X-Export-SHA256": chosen.sha256,
        "X-Export-Manifest-Root": manifest.root,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("society export error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import RetentionArchive from "@/models/RetentionArchive";
import { policyById } from "@/lib/retention/policies";
import { buildRetentionBundle } from "@/lib/retention/bundle";
import { requireRoles, SOCIETY_ADMIN_ROLES } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Building five formats over 25k rows is CPU-bound. Generous, but this runs at
// most a handful of times a month per society — unlike the old nightly build
// which paid this cost for every society every night whether or not anyone
// wanted the output.
export const maxDuration = 300;

/**
 * GET /api/retention/archives/:id/download
 *
 * Builds the bundle **now, in memory** and streams it to the browser. Nothing
 * is written to R2, nothing is written to disk, nothing is cached.
 *
 * ## Why on-demand instead of a nightly pre-build
 *
 * At 100 societies, pre-building meant ~36,500 zips a year sitting in a bucket,
 * the overwhelming majority never opened once, while the source data still
 * existed in Mongo anyway (it has not been purged yet — that is the entire
 * point of the two-phase design). You were paying storage to duplicate data you
 * already had, plus upload egress, plus download egress, plus nightly CPU.
 *
 * On demand, the cost is exactly proportional to use: zero for a society that
 * never downloads, one burst of CPU for one that does.
 *
 * ## The download is the consent signal
 *
 * Completing a download flips status to `downloaded` and stamps
 * `downloadedAt`. That stamp is the ONLY thing that makes the purge job
 * eligible to delete the source rows. Not "an email was sent" — that proves
 * nothing about whether a human received anything.
 *
 * Note the ordering below: the bundle is fully built and the sha256 computed
 * BEFORE the archive is marked downloaded. If generation throws, nothing is
 * marked, and the data stays exactly where it is.
 *
 * ?format=zip  (default) - all five formats in one zip
 * ?format=xlsx|csv|json|docx|pdf - a single file
 */

const SINGLE_FORMATS = {
  xlsx: {
    ext: "xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  csv: { ext: "csv", mime: "text/csv; charset=utf-8" },
  json: { ext: "json", mime: "application/json" },
  docx: {
    ext: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  pdf: { ext: "pdf", mime: "application/pdf" },
};

async function loadModel(policy) {
  const guessName = policy.modelPath.split("/").pop();
  if (mongoose.models[guessName]) return mongoose.models[guessName];
  const mod = await import(`${policy.modelPath}`);
  return mod.default;
}

export async function GET(request, { params }) {
  try {
    await connectDB();
    const auth = requireRoles(request, SOCIETY_ADMIN_ROLES);
    if (!auth.valid) return auth;
    const { societyId, userId, name } = auth.user;

    const { id } = await params;
    if (!/^[a-f\d]{24}$/i.test(id)) {
      return NextResponse.json({ error: "Invalid archive id" }, { status: 400 });
    }

    // Society scoping in the query itself, not as a post-hoc check — a wrong
    // id from another society simply returns 404, leaking nothing about
    // whether it exists.
    const archive = await RetentionArchive.findOne({ _id: id, societyId }).lean();
    if (!archive) {
      return NextResponse.json({ error: "Archive not found" }, { status: 404 });
    }
    if (archive.status === "purged") {
      return NextResponse.json(
        {
          error: "This archive has already been purged",
          detail:
            "The source records were deleted after your earlier download. Use the copy you downloaded on " +
            new Date(archive.downloadedAt).toLocaleDateString("en-IN"),
        },
        { status: 410 },
      );
    }

    const policy = policyById(archive.policyId);
    if (!policy) {
      return NextResponse.json({ error: "Unknown policy" }, { status: 500 });
    }

    const url = new URL(request.url);
    const format = (url.searchParams.get("format") || "zip").toLowerCase();

    // Fetch the pinned documents. Not a re-run of the age query — the exact
    // frozen id set, so what you download is provably what gets deleted.
    const Model = await loadModel(policy);
    const docs = await Model.find({ _id: { $in: archive.docIds } }).lean();

    // Strip large/sensitive fields per policy before they reach the file.
    const redact = policy.redact ?? [];
    const clean = docs.map((d) => {
      const copy = { ...d };
      for (const f of redact) delete copy[f];
      delete copy.__v;
      delete copy.retentionArchivedAt;
      delete copy.retentionArchiveId;
      return copy;
    });

    const bundle = await buildRetentionBundle({
      policy,
      societyName: archive.societyName || societyId,
      runDate: archive.runDate,
      cutoff: archive.cutoff,
      docs: clean,
      // Single-format requests skip building the other four entirely.
      only: format === "zip" ? null : format,
    });

    // Only NOW, after the bytes exist, record the download. If anything above
    // threw, the archive is untouched and the data is not at risk.
    await RetentionArchive.updateOne(
      { _id: archive._id },
      {
        $set: {
          status: "downloaded",
          downloadedAt: archive.downloadedAt ?? new Date(),
          downloadedBy: name || userId || "unknown",
          deliveredSha256: bundle.sha256,
        },
        $inc: { downloadCount: 1 },
        $addToSet: { downloadedFormats: format },
      },
    );

    const meta = SINGLE_FORMATS[format];
    const filename =
      format === "zip" ? bundle.filename : bundle.filename.replace(/\.zip$/, `.${meta.ext}`);

    return new NextResponse(bundle.buffer, {
      status: 200,
      headers: {
        "Content-Type": format === "zip" ? "application/zip" : meta.mime,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(bundle.buffer.length),
        // Never cache: this is per-society data behind auth, and an
        // intermediary caching it would be a cross-tenant leak.
        "Cache-Control": "private, no-store, max-age=0",
        "X-Record-Count": String(clean.length),
        "X-Content-Sha256": bundle.sha256,
      },
    });
  } catch (error) {
    console.error("Retention download error:", error);
    return NextResponse.json(
      { error: "Failed to build archive" },
      { status: 500 },
    );
  }
}

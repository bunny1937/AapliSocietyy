import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import User from "@/models/User";
import AuditLog from "@/models/AuditLog";
import ImportStaging from "@/models/ImportStaging";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import cache from "@/lib/cache";
import { requireRoles, SOCIETY_ADMIN_ROLES } from "@/lib/authz";
import { invalidateSocietySnapshot } from "@/lib/import/societySnapshot";
import { authorize } from "@/lib/rbac/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function generatePassword() {
  return randomBytes(6).toString("base64url").toUpperCase();
}

/**
 * POST /api/members/confirm-import  { stagingId }
 *
 * ## What changed
 *
 * Was:  `{ tempFilePath }` → `readFile(resolvedPath)` → re-parse the workbook
 *       with ExcelJS → insert.
 *
 * Now:  `{ stagingId }` → read pre-parsed rows from Mongo → insert.
 *
 * The old version could not work on Vercel at all — see the comment block in
 * models/ImportStaging.js. It also parsed the same .xlsx a second time, having
 * already parsed it during preview, which for a 500-row enhanced template is
 * several seconds of CPU duplicated for no reason.
 *
 * Three further hardening changes:
 *
 *  - **Society scoping in the query.** The staging document is fetched with
 *    `{ _id, societyId }` from the caller's own token. The old path-traversal
 *    guard (`resolvedPath.startsWith(tempDir)`) protected the filesystem but
 *    did nothing to stop one society confirming another society's upload.
 *  - **Single-use.** `consumedAt` is set atomically, so a double-submit — an
 *    impatient admin, or the browser retrying a request that timed out
 *    server-side but succeeded — cannot import the same sheet twice. This was
 *    previously prevented only by the temp file having been unlinked, which is
 *    a race, not a guarantee.
 *  - **Bulk insert.** `insertMany` in one round trip instead of a `create()`
 *    per row.
 */
export async function POST(request) {
  try {
    const gate = await authorize(request, "member.member.import");
    if (!gate.ok) return gate.response;
    await connectDB();    const decoded = gate.context;

    const body = await request.json();
    const stagingId = body.stagingId || body.previewId;
    if (!stagingId) {
      return NextResponse.json(
        {
          error: "No staged import specified",
          hint: "Send { stagingId } from the preview response. `tempFilePath` is no longer used.",
        },
        { status: 400 },
      );
    }

    // Atomic claim: scoped to this society, and only if not already consumed.
    // If two requests race, exactly one gets the document.
    const staged = await ImportStaging.findOneAndUpdate(
      {
        _id: stagingId,
        societyId: decoded.societyId,
        kind: "members",
        consumedAt: null,
      },
      { $set: { consumedAt: new Date() } },
      { new: true },
    ).lean();

    if (!staged) {
      // Distinguish the three reasons so the admin gets an actionable message
      // instead of a generic failure.
      const any = await ImportStaging.findOne({
        _id: stagingId,
        societyId: decoded.societyId,
      }).lean();
      if (any?.consumedAt) {
        return NextResponse.json(
          { error: "This import has already been completed.", completedAt: any.consumedAt },
          { status: 409 },
        );
      }
      return NextResponse.json(
        {
          error: "Preview expired",
          hint: "Staged imports are kept for one hour. Upload the file again to re-validate.",
        },
        { status: 410 },
      );
    }

    const rows = (staged.rows ?? []).filter((r) => !r.hasBlockingError);
    const skipped = (staged.rows ?? []).length - rows.length;

    if (!rows.length) {
      return NextResponse.json(
        { error: "No valid rows to import", skipped },
        { status: 400 },
      );
    }

    // Build documents in memory, insert in one round trip.
    const memberDocs = rows.map((r) => ({
      societyId: decoded.societyId,
      flatNo: r.flatNo,
      wing: r.wing,
      ownerName: r.ownerName,
      contactNumber: r.contactNumber,
      emailPrimary: r.emailPrimary,
      carpetAreaSqft: r.carpetAreaSqft,
      isDeleted: false,
      advanceCredit: 0,
      importStagingId: String(staged._id),
    }));

    const createdMembers = await Member.insertMany(memberDocs, { ordered: false });

    // Credentials for members that supplied an email.
    const credentials = [];
    const userDocs = [];
    for (let i = 0; i < createdMembers.length; i++) {
      const m = createdMembers[i];
      if (!m.emailPrimary) continue;
      const password = generatePassword();
      credentials.push({
        name: m.ownerName,
        flatNo: `${m.wing || ""}${m.wing ? "-" : ""}${m.flatNo}`,
        email: m.emailPrimary,
        password,
      });
      userDocs.push({
        societyId: decoded.societyId,
        memberId: m._id,
        name: m.ownerName,
        email: m.emailPrimary,
        // Hashing is the slow part of an import. 10 rounds is the bcrypt
        // default and is the right trade here; going higher turns a 500-member
        // import into a function timeout.
        password: await bcrypt.hash(password, 10),
        role: "Member",
        importStagingId: String(staged._id),
      });
    }
    if (userDocs.length) await User.insertMany(userDocs, { ordered: false });

    await AuditLog.create({
      userId: decoded.userId,
      societyId: decoded.societyId,
      action: "IMPORT_MEMBERS",
      newData: {
        importedCount: createdMembers.length,
        usersCreated: userDocs.length,
        skippedInvalid: skipped,
        stagingId: String(staged._id),
        fileName: staged.fileName,
      },
      timestamp: new Date(),
    });

    // The member set just changed — drop the validation snapshot so the next
    // import validates against reality rather than a five-minute-old view.
    await Promise.all([
      invalidateSocietySnapshot(decoded.societyId),
      cache.delPattern(`members:list:${decoded.societyId}:*`),
      cache.del("admin:stats:global"),
    ]);

    return NextResponse.json({
      success: true,
      createdMembers: createdMembers.map((m) => ({
        _id: m._id,
        flatNo: m.flatNo,
        wing: m.wing,
        ownerName: m.ownerName,
      })),
      imported: createdMembers.length,
      usersCreated: userDocs.length,
      skippedInvalid: skipped,
      // Shown once. Download via /api/members/download-credentials.
      credentials,
    });
  } catch (error) {
    console.error("Confirm import error:", error);
    return NextResponse.json(
      { error: "Import failed" },
      { status: 500 },
    );
  }
}

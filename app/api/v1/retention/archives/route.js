import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import RetentionArchive from "@/models/RetentionArchive";
import RetentionSetting from "@/models/RetentionSetting";
import { policyById } from "@/lib/retention/policies";
import { requireRoles, SOCIETY_ADMIN_ROLES } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/retention/archives
 *
 * Everything waiting for this society's admin. Powers the Data Archive page
 * and the dashboard badge.
 *
 * Scoped to `decoded.societyId` from the caller's own token — there is no
 * societyId parameter, so one society's admin structurally cannot enumerate or
 * download another society's archives.
 *
 * Deliberately returns metadata only, never `docIds`. The id list can be tens
 * of thousands of entries; the page only needs counts. The ids are read
 * server-side at download time.
 */
export async function GET(request) {
  try {
    await connectDB();
    const auth = requireRoles(request, SOCIETY_ADMIN_ROLES);
    if (!auth.valid) return auth;
    const societyId = auth.user.societyId;

    const [archives, setting] = await Promise.all([
      RetentionArchive.find({
        societyId,
        status: { $in: ["pending", "downloaded", "purged"] },
      })
        .select("-docIds")
        .sort({ createdAt: -1 })
        .limit(120)
        .lean(),
      RetentionSetting.findOne({ societyId }).lean(),
    ]);

    const items = archives.map((a) => {
      const policy = policyById(a.policyId);
      const override = setting?.policies?.find((p) => p.policyId === a.policyId);
      const willDelete = Boolean(
        setting?.enabled && override?.purgeEnabled && policy?.purgeable,
      );
      return {
        id: String(a._id),
        policyId: a.policyId,
        policyLabel: a.policyLabel || policy?.label || a.policyId,
        runDate: a.runDate,
        cutoff: a.cutoff,
        recordCount: a.recordCount,
        status: a.status,
        downloadedAt: a.downloadedAt,
        downloadedBy: a.downloadedBy,
        downloadCount: a.downloadCount,
        purgedAt: a.purgedAt,
        purgedCount: a.purgedCount,
        // What the UI needs to set expectations honestly.
        archiveOnly: !policy?.purgeable,
        willDeleteAfterDownload: willDelete,
        // Plain-language line for the row.
        note: !policy?.purgeable
          ? "Archive only — these records are kept in the system permanently."
          : willDelete
            ? "These records will be deleted the night after you download them."
            : "Automatic deletion is off for this society — nothing will be removed.",
      };
    });

    const pending = items.filter((i) => i.status === "pending");

    return NextResponse.json({
      success: true,
      retentionEnabled: Boolean(setting?.enabled),
      pendingCount: pending.length,
      pendingRecords: pending.reduce((s, i) => s + i.recordCount, 0),
      // If this is > 0 and retentionEnabled is false, the honest message for
      // the admin is "here is an export you may find useful", not "act now".
      items,
    });
  } catch (error) {
    console.error("Retention archives list error:", error);
    return NextResponse.json(
      { error: "Failed to load archives" },
      { status: 500 },
    );
  }
}

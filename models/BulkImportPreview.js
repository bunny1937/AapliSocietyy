import mongoose from "mongoose";

// The validated-but-not-yet-written result of a bulk-import preview pass —
// see lib/import/bulkImportValidate.js runPreviewChecks() and
// app/api/admin/bulk-import/preview/route.js. Committing (POST
// /api/admin/bulk-import with a previewId) reads this back instead of
// re-parsing the file and re-running every DB uniqueness check, so a retry
// after a mid-import failure never repeats work already confirmed.
//
// TTL'd short — this is a few-minutes-long "I just checked, go ahead and
// write it" handoff between two requests in the same admin session, not a
// durable record of anything.
const BulkImportPreviewSchema = new mongoose.Schema(
  {
    previewId: { type: String, required: true, unique: true },
    societyPayload: { type: mongoose.Schema.Types.Mixed, required: true },
    validMembers: { type: mongoose.Schema.Types.Mixed, required: true },
    // [[email, {_id, username}], ...] — a Map isn't BSON-storable directly.
    existingMemberEmailMap: { type: mongoose.Schema.Types.Mixed, default: [] },
    multiSocietyAdminUserId: { type: String, default: null },
    warnings: [{ type: String }],
    used: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now, expires: 1800 }, // 30 min TTL
  },
  { timestamps: false },
);

export default mongoose.models.BulkImportPreview ||
  mongoose.model("BulkImportPreview", BulkImportPreviewSchema);

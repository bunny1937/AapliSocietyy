import mongoose from "mongoose";
const TenantRequestDocumentsSchema = new mongoose.Schema(
  {
    contractKey: String,
    // Legacy only: superseded by `acknowledgement` on the request itself.
    // A scanned signature proved that somebody, somewhere, held a pen; it was
    // never tied to the account that submitted the request. Nothing writes
    // this any more.
    signatureKey: String,
    // Legacy only: declared so rows written before D1 still parse. Nothing
    // writes it, no route serves it, and scripts/clear-tenant-aadhaar.mjs
    // removes both the pointer and the stored object.
    aadhaarKey: String,
    policeVerificationKey: String,
  },
  { _id: false },
);
// Mirrors mobile-backend's TenantRequest collection (apps/mobile-backend/src/models/index.ts).
// Owner-submitted, admin-pending tenant onboarding data — deliberately its own
// collection, not written onto Member.currentTenant, until this app's approve
// route below accepts it.
const TenantRequestSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: "Member", required: true, index: true },
    requestedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    tenantName: { type: String, required: true },
    tenantPhone: { type: String, required: true },
    tenantEmail: { type: String, required: true },
    leaseStartDate: { type: Date, required: true },
    // Blank while the tenant is active; populated when the owner ends the lease.
    leaseEndDate: { type: Date, default: null },
    rentPerMonth: { type: Number, required: true },
    depositAmount: { type: Number, default: 0 },
    documents: TenantRequestDocumentsSchema,
    // What replaced the signature image. Tied to a user id and a timestamp, so
    // it answers "who agreed to this and when" — which the image never could.
    acknowledgement: new mongoose.Schema(
      {
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        byName: String,
        at: { type: Date, default: Date.now },
        // Best-effort, for a disputed submission. Never used for anything else.
        ip: String,
      },
      { _id: false },
    ),
    // ── document retention ──
    //
    // Nothing here used to expire. A tenant who left in 2019 still had their
    // agreement in our bucket, which is the same open-ended retention the
    // society-offboarding work exists to close — just in a different corner,
    // and holding a document nobody will ever open again is pure liability.
    //
    // Set when the tenancy ends (lease end, rejection, or closure) and read by
    // /v1/cron/tenant-document-purge. Null while the tenancy is live: an
    // active tenant's agreement is in use and is not on a clock.
    documentsExpireAt: { type: Date, default: null, index: true },
    documentsPurgedAt: Date,
    status: { type: String, enum: ["Pending", "Approved", "Rejected", "Closed"], default: "Pending", index: true },
    // Mirrors the tenant User's isActive flag so GET /v1/tenant-requests can
    // report login state without a join (see [id]/login/route.js). Was never
    // declared here, so `request.loginEnabled = enabled; request.save()`
    // silently dropped the assignment under Mongoose's default strict mode —
    // the owner's toggle always reverted to OFF.
    loginEnabled: { type: Boolean, default: false },
    rejectionReason: String,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedAt: Date,
    leaseExpiredAt: Date,
    // Owner-authored notes on the tenancy (visible to owner + admin).
    notes: [
      new mongoose.Schema(
        { text: String, at: { type: Date, default: Date.now }, by: String },
        { _id: false },
      ),
    ],
    // Two-way owner<->tenant message thread (see [id]/notes/route.js). Was
    // never declared here, so `request.noteThread = [...]` + save() silently
    // dropped every posted message under Mongoose's default strict mode.
    noteThread: [
      new mongoose.Schema(
        { text: String, at: { type: Date, default: Date.now }, by: String },
        { _id: false },
      ),
    ],
    // Proposed lease-date change awaiting admin approval. The live
    // leaseStartDate/leaseEndDate are untouched until the admin approves.
    pendingLeaseChange: {
      leaseStartDate: Date,
      leaseEndDate: Date,
      requestedAt: Date,
      status: { type: String, enum: ["Pending", "Approved", "Rejected"] },
      decidedAt: Date,
    },
    ownerConfirmedMoveOutAt: Date,
    adminConfirmedMoveOutAt: Date,
  },
  { timestamps: true },
);
export default mongoose.models.TenantRequest || mongoose.model("TenantRequest", TenantRequestSchema);
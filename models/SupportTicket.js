import mongoose from "mongoose";

// Admin -> Superadmin support ticket. Screenshots are stored inline as
// base64 (capped at 512KB each, 2 max — see lib/support/ticketPolicy.js for
// the enforced limits) rather than pushed through the R2 presign flow used
// for member-facing uploads: at this size (<=1MB total for the pair) a
// document stays comfortably under Mongo's 16MB cap, and it means every
// "view this ticket" read is one query with nothing to separately fetch,
// sign, or expire. Screenshots/logs are shown inline in the UI — this
// schema and the API layer never hand back anything shaped like a
// downloadable file (no Content-Disposition: attachment, no direct asset
// URL), by design.
const SupportTicketSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    // Snapshotted at submit time — a society rename or admin name change
    // later must not rewrite history superadmin already saw and acted on.
    societyName: { type: String, required: true, trim: true },
    submittedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    submittedByName: { type: String, required: true, trim: true },

    category: {
      type: String,
      required: true,
      enum: ["Enquiry", "Complaint", "Error", "Bug", "Data Issue", "General Issue"],
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 5,
      maxlength: 150,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 4000,
    },
    // Pasted stack traces / console output — plain text, not a file. Capped
    // generously above the enforced per-request limit (see ticketPolicy.js)
    // so a schema change is never the reason a legitimate paste gets cut.
    errorLogs: {
      type: String,
      trim: true,
      maxlength: 20000,
    },
    screenshots: {
      type: [
        {
          _id: false,
          data: { type: String, required: true }, // data: URI, e.g. "data:image/png;base64,...."
          contentType: { type: String, required: true },
          size: { type: Number, required: true }, // decoded byte size, server-computed — never trust the client's claim
          filename: { type: String, trim: true, maxlength: 200 },
        },
      ],
      validate: {
        validator: (arr) => arr.length <= 2,
        message: "Maximum 2 screenshots per ticket",
      },
      default: [],
    },

    status: {
      type: String,
      enum: ["Received", "Acknowledged", "Working", "Pending", "Completed", "Reverted"],
      default: "Received",
      index: true,
    },
    // One row per status change, oldest first — the timeline the admin sees
    // on their own ticket, and the audit trail of who moved it and when.
    statusHistory: {
      type: [
        {
          _id: false,
          status: { type: String, required: true },
          note: { type: String, trim: true, maxlength: 1000 },
          changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "SuperAdmin" },
          changedByName: { type: String, trim: true },
          changedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

SupportTicketSchema.index({ status: 1, createdAt: -1 });
SupportTicketSchema.index({ societyId: 1, createdAt: -1 });
SupportTicketSchema.index({ category: 1, createdAt: -1 });

export default mongoose.models.SupportTicket ||
  mongoose.model("SupportTicket", SupportTicketSchema);

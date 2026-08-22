import mongoose from "mongoose";

/**
 * ============================================================================
 * RoleAssignment — links a User to a Role within ONE society.
 * ============================================================================
 * Multi-society (Q1): a user has separate assignments per society.
 * Multi-role in one society (Q2): a user may have several ACTIVE assignments
 * in the same society; the engine unions them (deny-override) within that
 * society's active staff hat only.
 *
 * `status`:
 *   - active    : counts toward effective permissions
 *   - suspended : temporarily ignored (leave/absence) without losing the link
 *   - revoked   : historical record kept for audit; never grants
 *
 * `expiresAt` (nullable): supports time-bound assignments (committee rotation /
 * temporary treasurer). A scheduled job flips expired -> revoked and bumps the
 * user's session epoch. Null = permanent until unassigned.
 * ============================================================================
 */
const RoleAssignmentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    societyId: { type: String, required: true, index: true },
    roleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
      required: true,
      index: true,
    },

    // Denormalized for fast display + audit without a Role join.
    roleKey: { type: String, required: true },

    // ---- Optional flat link -------------------------------------------
    // Lets a staff grant (admin, guard, auditor, clubhouse manager...) also
    // name the person's OWN flat in this society, so "admin who is also a
    // resident" is one record instead of a second mechanism. Nothing reads
    // this to change what the role can DO — permissions still come entirely
    // from roleId. It only surfaces the flat as a linked profile in the
    // login/switch-profile picker (see lib/rbac/staff-profiles.js) and lets
    // the RBAC screen show "Auditor — also lives in A-204".
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Member",
      default: null,
    },
    // Denormalized for the picker/admin list without a Member join.
    flatNo: { type: String, trim: true, default: null },
    wing: { type: String, trim: true, default: null },

    status: {
      type: String,
      enum: ["active", "suspended", "revoked"],
      default: "active",
      index: true,
    },

    expiresAt: { type: Date, default: null },

    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    revokedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// A user cannot hold the SAME role twice in the SAME society.
RoleAssignmentSchema.index(
  { userId: 1, societyId: 1, roleId: 1 },
  { unique: true },
);
// Fast "who has this role" queries for the deletion impact-preview.
RoleAssignmentSchema.index({ societyId: 1, roleId: 1 });
// Fast expiry sweeps.
RoleAssignmentSchema.index({ status: 1, expiresAt: 1 });

export default mongoose.models.RoleAssignment ||
  mongoose.model("RoleAssignment", RoleAssignmentSchema);

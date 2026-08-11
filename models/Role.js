import mongoose from "mongoose";

/**
 * ============================================================================
 * Role — a named permission set, scoped to ONE society (multi-tenant).
 * ============================================================================
 * Two kinds:
 *   1. System templates (isSystem: true)  -> seeded per society from
 *      lib/rbac/system-role-defaults.js. Identity locked (key + name), CANNOT
 *      be deleted, but permissions ARE editable (Decision Q4).
 *   2. Custom roles (isSystem: false)     -> created/cloned by the admin,
 *      fully editable, deletable with impact preview (Decision Q6).
 *
 * IMPORTANT (Rev 2): every role — including system templates — carries a
 * societyId. There is no global/null-society role. This is what lets each
 * society edit its own template copy without leaking into other societies.
 *
 * `permissions` and `denies` store CONCRETE leaf ids only (module.resource.action).
 * Authoring wildcards (module.* / module.resource.*) are expanded to leaves by
 * the role-service BEFORE persisting, so evaluation never has to expand at runtime.
 * ============================================================================
 */
const RoleSchema = new mongoose.Schema(
  {
    societyId: { type: String, required: true, index: true },

    // Stable machine key. For system templates this equals the template key
    // (admin/secretary/accountant/security) and is immutable.
    key: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    color: { type: String, default: "gray" },

    isSystem: { type: Boolean, default: false, index: true },

    // Concrete leaf permission ids (already expanded). Deny-override wins.
    permissions: { type: [String], default: [] },
    denies: { type: [String], default: [] },

    // Audit / provenance
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // If this role was cloned, remember the source for the audit trail.
    clonedFromKey: { type: String, default: null },
  },
  {
    timestamps: true,
    // Optimistic concurrency: concurrent admin edits to the SAME role doc fail
    // the stale write instead of silently clobbering (challenge #7). Callers
    // must reload + retry on VersionError.
    optimisticConcurrency: true,
  },
);

// One role key per society (system + custom share the namespace).
RoleSchema.index({ societyId: 1, key: 1 }, { unique: true });

// System templates cannot be deleted — enforce at the model layer as a
// defense-in-depth backstop to the service-layer guard (Decision Q4).
RoleSchema.pre("deleteOne", { document: true, query: false }, function (next) {
  if (this.isSystem) {
    return next(new Error("SYSTEM_ROLE_UNDELETABLE"));
  }
  next();
});

export default mongoose.models.Role || mongoose.model("Role", RoleSchema);

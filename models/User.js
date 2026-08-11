import mongoose from "mongoose";
// ─── Profile sub-document (one per society membership) ───────────────────────
const ProfileSchema = new mongoose.Schema(
  {
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      default: () => new mongoose.Types.ObjectId(),
    },
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
    },
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Member",
      required: function () {
        return this.kind !== "Commercial";
      },
    },
    // Which kind of unit this profile represents. Residential (default) links
    // memberId/flatNo/wing as today; Commercial links shopId instead — the
    // shop's own identity (shopNo, unitKind, tradeName) lives on models/Shop.js,
    // never duplicated onto this sub-document.
    kind: {
      type: String,
      enum: ["Residential", "Commercial"],
      default: "Residential",
    },
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      default: null,
      required: function () {
        return this.kind === "Commercial";
      },
    },
    role: {
      type: String,
      enum: ["Member", "Secretary", "Accountant", "Treasurer"],
      default: "Member",
    },
    occupancyType: {
      type: String,
      enum: ["Owner", "Tenant"],
      default: "Owner",
    },
    flatNo: { type: String, trim: true, default: "" },
    wing: { type: String, trim: true, default: "" },
    societyName: { type: String, trim: true, default: "" },
    isPrimary: { type: Boolean, default: false },
    status: { type: String, enum: ["Active", "Inactive"], default: "Active" },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);
// ─── Main User schema ─────────────────────────────────────────────────────────
const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    // username: for Member login  (GH_TANVIB_1001_27)
    // sparse so Admin docs can omit it without unique conflicts
    username: {
      type: String,
      lowercase: true,
      trim: true,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      // NOT unique at schema level — uniqueness enforced by app logic
      // (same person can appear in multiple societies with same email)
    },
    phone: {
      type: String,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    // ── Admin / Secretary accounts keep root-level fields ──────────────────
    // Member accounts: role="Member", societyId/memberId live inside profiles[]
    role: {
      type: String,
      enum: [
        "SuperAdmin",
        "Admin",
        "Secretary",
        "Accountant",
        "Auditor",
        "Member",
        "Security",
      ],
      default: "Member",
    },
    societyId: {
      // Kept for Admin / Secretary only. Members: use activeProfile.societyId
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
    },
    societyCode: { type: String }, // kept for SOCIETY_ADMIN compat
    // Security guard fields (only populated when role === 'Security')
    gateLabel: { type: String, trim: true, default: "Main Gate" }, // e.g. "Main Gate", "Rear Gate"
    pin: { type: String }, // store hashed PIN only, never raw PIN
    // ── Member multi-society profiles ──────────────────────────────────────
    profiles: {
      type: [ProfileSchema],
      default: [],
    },
    activeProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      // points to profiles[n].profileId for the current session
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // True for members created via bulk-import until they complete the
    // onboarding "set your own credentials" flow (auto-generated username
    // and temp password aren't meant to be permanent).
    mustChangePassword: {
      type: Boolean,
      default: false,
    },
    // Bulk-import provenance — see Society.importRunId
    importRunId: { type: String, default: null, index: true },
    // RBAC (Rev 2): monotonic counter embedded in every access JWT. Bumped on
    // privilege reduction to force re-auth (see lib/rbac/session.js).
    sessionEpoch: { type: Number, default: 0 },
  },
  { timestamps: true },
);
// ── Indexes ───────────────────────────────────────────────────────────────────
UserSchema.index({ username: 1 }, { unique: true, sparse: true });
UserSchema.index({ email: 1 });
UserSchema.index({ phone: 1 });
UserSchema.index({ "profiles.memberId": 1 });
UserSchema.index({ "profiles.societyId": 1 });
UserSchema.index({ societyId: 1 }); // existing admin queries still fast
export default mongoose.models.User || mongoose.model("User", UserSchema);
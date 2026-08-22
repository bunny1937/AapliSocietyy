/**
 * Turns a user's active RoleAssignments into selectable "profiles", the same
 * shape the login/profile-select flow already uses for member flat profiles.
 *
 * Master-plan requirement (§7): a person can have Flat 001 / Flat 004 /
 * Manager all in one picker. Before this, RoleAssignment was invisible to
 * login/switch-profile entirely — granting someone a management role gave
 * them no way to ever use it. This is the missing link, additive only:
 * member profile selection/login is untouched, this just adds more entries
 * to the same list.
 */
import connectDB from "@/lib/mongodb";
import RoleAssignment from "@/models/RoleAssignment";
import Role from "@/models/Role";
import Society from "@/models/Society";

const STAFF_PROFILE_PREFIX = "staff:";

export function isStaffProfileId(id) {
  return typeof id === "string" && id.startsWith(STAFF_PROFILE_PREFIX);
}

export function staffProfileId(assignmentId) {
  return `${STAFF_PROFILE_PREFIX}${assignmentId}`;
}

export function assignmentIdFromProfileId(profileId) {
  return isStaffProfileId(profileId) ? profileId.slice(STAFF_PROFILE_PREFIX.length) : null;
}

/** @returns {Promise<Array<{profileId:string, societyId:string, societyName:string, role:string, kind:'Staff'}>>} */
export async function getStaffProfiles(userId) {
  await connectDB();
  const now = new Date();
  const assignments = await RoleAssignment.find({
    userId,
    status: "active",
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  }).lean();
  if (!assignments.length) return [];

  const roleIds = [...new Set(assignments.map((a) => String(a.roleId)))];
  const societyIds = [...new Set(assignments.map((a) => String(a.societyId)))];
  const [roles, societies] = await Promise.all([
    Role.find({ _id: { $in: roleIds } }).select("name color").lean(),
    Society.find({ _id: { $in: societyIds } }).select("name").lean(),
  ]);
  const roleById = new Map(roles.map((r) => [String(r._id), r]));
  const societyById = new Map(societies.map((s) => [String(s._id), s]));

  return assignments.map((a) => {
    const role = roleById.get(String(a.roleId));
    const society = societyById.get(String(a.societyId));
    return {
      profileId: staffProfileId(String(a._id)),
      assignmentId: String(a._id),
      societyId: String(a.societyId),
      societyName: society?.name || "",
      role: role?.name || a.roleKey || "Staff",
      // The stable key (e.g. "admin", "accountant"), distinct from `role`
      // above which is the DISPLAY name and can differ from it (accountant's
      // display name is "Treasurer" — see lib/rbac/system-role-defaults.js).
      // Callers that need to map back to a legacy role string
      // (lib/rbac/legacy-role-bridge.js) must use this, not `role`.
      roleKey: role?.key || a.roleKey || null,
      roleColor: role?.color || null,
      kind: "Staff",
      // Present only when this grant was linked to the grantee's own flat
      // (see models/RoleAssignment.js). Lets the picker show "Auditor —
      // A-204" instead of a bare role name for someone who is also a resident.
      flatNo: a.flatNo || null,
      wing: a.wing || null,
    };
  });
}

/** Verify an assignment id belongs to this user and is currently active. */
export async function loadActiveAssignment(userId, assignmentId) {
  await connectDB();
  const now = new Date();
  const a = await RoleAssignment.findOne({
    _id: assignmentId,
    userId,
    status: "active",
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  }).lean();
  return a || null;
}

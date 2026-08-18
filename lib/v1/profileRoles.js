// lib/v1/profileRoles.js
//
// Attaches each picker profile's RBAC roles (Manage Access grants, e.g.
// Clubhouse Manager) BEFORE the client has picked one. Unlike claims.staffRoles
// (only known once a profile is active, from its baked-in JWT), this is
// possible here because every profile in the picker already carries its own
// societyId — a grant is scoped to {userId, societyId}, and each profile
// names its society independently.
//
// Shared by /v1/auth/login and /v1/auth/my-profiles so the two pickers (login
// screen, in-session switcher) can never drift on which profile shows which
// role.
import { listActiveStaffRoles } from "@/lib/rbac/assignment-service";
import { STAFF_ROLE_MOBILE_ROUTES } from "@/lib/v1/staffRoleRoutes";

/**
 * @param pickerProfiles - output of toPickerProfile(), same order as sourceProfiles
 * @param sourceProfiles - raw user.profiles[] subdocuments (carries societyId)
 * @param userId
 * @returns pickerProfiles, each with a `roles: [{key,label,route}]` field added
 */
export async function attachProfileRoles(pickerProfiles, sourceProfiles, userId) {
  // One RoleAssignment query per distinct society, not per profile - a
  // household with two flats in the same society shouldn't double the work.
  const societyIds = [
    ...new Set(sourceProfiles.map((p) => String(p.societyId ?? "")).filter(Boolean)),
  ];
  const rolesBySociety = new Map(
    await Promise.all(
      societyIds.map(async (societyId) => [
        societyId,
        (await listActiveStaffRoles(userId, societyId))
          .filter((r) => STAFF_ROLE_MOBILE_ROUTES[r.key])
          .map((r) => ({ key: r.key, label: r.label, route: STAFF_ROLE_MOBILE_ROUTES[r.key] })),
      ]),
    ),
  );
  return pickerProfiles.map((picker, i) => ({
    ...picker,
    roles: rolesBySociety.get(String(sourceProfiles[i].societyId ?? "")) ?? [],
  }));
}

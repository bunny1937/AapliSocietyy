import Society from "@/models/Society";
import User from "@/models/User";
import cache from "@/lib/cache";
import { SOCIETY_COLLECTIONS } from "./societyCollections";

const PAUSE_CACHE_PREFIX = "paused-society:"; // read by middleware.js
const VERIFIED_CACHE_PREFIX = "society-delete-verified:";

/**
 * The one hard-delete implementation. Every route that permanently removes a
 * society (the LOOP-05 wizard's delete-permanently, quick-delete-test, the
 * legacy delete-society endpoint) goes through here so the blast radius can
 * never drift apart between them — and so it stays exactly the collection set
 * buildSocietyExportBundle snapshots. Anything deleted but not exported is
 * data with no way back.
 */
export async function purgeSociety(societyId) {
  const deleted = {};
  await Promise.all(
    SOCIETY_COLLECTIONS.map(async ({ key, Model }) => {
      try {
        const res = await Model.deleteMany({ societyId });
        if (res.deletedCount) deleted[key] = res.deletedCount;
      } catch (err) {
        // One model with an incompatible societyId type must not abort the
        // purge and leave the society half-deleted.
        console.warn(`purgeSociety: ${key} —`, err.message);
      }
    }),
  );

  // Only accounts whose root/home societyId is this one. A multi-society
  // admin or a member with a staff role elsewhere keeps their account — the
  // $pull below removes just their profile entry for this society.
  const users = await User.deleteMany({ societyId });
  if (users.deletedCount) deleted.users = users.deletedCount;

  const staleProfileUsers = await User.find({ "profiles.societyId": societyId })
    .select("_id activeProfileId profiles")
    .lean();
  let profilesPulled = 0;
  for (const u of staleProfileUsers) {
    const removedIds = (u.profiles || [])
      .filter((p) => String(p.societyId) === String(societyId))
      .map((p) => String(p.profileId));
    profilesPulled += removedIds.length;
    const update = { $pull: { profiles: { societyId } } };
    // Leaving activeProfileId pointing at a profile that no longer exists
    // logs the user into a dead society on their next request.
    if (removedIds.includes(String(u.activeProfileId))) update.$set = { activeProfileId: null };
    await User.updateOne({ _id: u._id }, update);
  }

  await Society.findByIdAndDelete(societyId);
  await cache.del(`${PAUSE_CACHE_PREFIX}${societyId}`, `${VERIFIED_CACHE_PREFIX}${societyId}`);

  return { ...deleted, staleProfilesPulled: profilesPulled };
}

export { PAUSE_CACHE_PREFIX, VERIFIED_CACHE_PREFIX };

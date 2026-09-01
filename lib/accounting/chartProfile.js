/**
 * SocietyChartProfile reads/writes. SERVER ONLY.
 * See models/SocietyChartProfile.js for what this is and why it exists.
 */
import SocietyChartProfile from "@/models/SocietyChartProfile";
import ChartOfAccount from "@/models/ChartOfAccount";
import { STANDARD_ACCOUNTS, OPTIONAL_ACCOUNTS } from "@/lib/accounting/standardAccounts";

/**
 * Backfills on first read: a society with no profile yet gets one whose
 * `adoptedCodes` is exactly the standard codes it currently has active rows
 * for. Nothing is treated as "removed" retroactively — there is no way to
 * tell, from existing data alone, whether a missing code was never created
 * or was created-then-deleted before this collection existed. That
 * uncertainty resolves itself going forward: the next delete records itself.
 */
export async function getOrCreateChartProfile(societyId) {
  let profile = await SocietyChartProfile.findOne({ societyId });
  if (profile) return profile;

  const existing = await ChartOfAccount.find({ societyId, isDeleted: { $ne: true } }).select("code").lean();
  const codes = new Set(existing.map((a) => a.code));
  const adoptedCodes = STANDARD_ACCOUNTS.filter((a) => codes.has(a.code)).map((a) => a.code);

  profile = await SocietyChartProfile.create({ societyId, adoptedCodes, removedCodes: [] });
  return profile;
}

/** Records that a template code was deliberately removed — never "missing" again. */
export async function recordRemoved(societyId, code) {
  await getOrCreateChartProfile(societyId); // ensure the row exists first
  await SocietyChartProfile.updateOne(
    { societyId },
    { $addToSet: { removedCodes: code }, $pull: { adoptedCodes: code } },
  );
}

/** Records re-adoption if an admin re-adds a previously removed template code. */
export async function recordAdopted(societyId, code) {
  await getOrCreateChartProfile(societyId);
  await SocietyChartProfile.updateOne(
    { societyId },
    { $addToSet: { adoptedCodes: code }, $pull: { removedCodes: code } },
  );
}

/**
 * The three lists the guided setup / Heads page actually need, computed
 * together so they only walk STANDARD_ACCOUNTS and the live account rows
 * once.
 *
 * - `missing`   — template heads that don't exist AND were never deliberately
 *                 removed. This is what setup-state nags about.
 * - `available` — template heads that don't exist, full stop (includes
 *                 removed ones) — the "Available to add" catalog on the
 *                 Heads page, so a removed head is still one click away.
 * - `existingCodes` — the codes that do exist, for callers that need it.
 */
export async function getTemplateDiff(societyId) {
  const [profile, existing] = await Promise.all([
    getOrCreateChartProfile(societyId),
    ChartOfAccount.find({ societyId, isDeleted: { $ne: true } }).select("code").lean(),
  ]);
  const existingCodes = new Set(existing.map((a) => a.code));
  const removed = new Set(profile.removedCodes || []);

  const missing = STANDARD_ACCOUNTS.filter((a) => !existingCodes.has(a.code) && !removed.has(a.code));
  // OPTIONAL_ACCOUNTS never nag as "missing" — they're not universal enough
  // for that — but sit in the same "Available to add" catalog as removed
  // template heads, one click away for the society that actually has one.
  const available = [...STANDARD_ACCOUNTS, ...OPTIONAL_ACCOUNTS].filter((a) => !existingCodes.has(a.code));

  return { missing, available, existingCodes, removedCodes: removed };
}
